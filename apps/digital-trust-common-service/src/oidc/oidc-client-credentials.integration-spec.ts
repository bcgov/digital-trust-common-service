import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { AppDataSource } from '@app/database/data-source';
import { buildSslConfig } from '@app/database/ssl.util';
import { OidcMountService } from '@app/oidc';
import { PgBossService } from '@app/pg-boss';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { hash, argon2i } from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import {
  buildBasicAuthHeader,
  issueTokenAndVerify,
} from '../../test/support/oidc-test-helpers';
import { AppModule } from '../app.module';

/**
 * End-to-end exercise of the client_credentials grant against a real
 * Postgres-backed `Provider` (see issue #34's explicit "Integration test:
 * obtain token via client_credentials, validate via JWKS" requirement).
 * Unlike the mocked unit tests in `oidc-provider.service.spec.ts`, this is
 * the only place a genuine (non-mocked) `oidc-provider` instance is
 * exercised, mounted exactly as `main.ts` mounts it in production via
 * `OidcMountService`.
 */
describe('OIDC client_credentials grant (integration)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let keysDir: string;
  let tenantId: string;
  let clientId: string;
  const clientSecret = 'a-very-secret-value';

  const mockBoss = {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
    createQueue: jest.fn().mockResolvedValue(undefined),
    schedule: jest.fn().mockResolvedValue(undefined),
    work: jest.fn().mockResolvedValue('worker-1'),
  };

  beforeAll(async () => {
    keysDir = mkdtempSync(join(tmpdir(), 'oidc-it-'));
    process.env.OIDC_KEYS_PATH = join(keysDir, 'oidc-keys.json');
    process.env.OIDC_ISSUER = 'http://localhost:3000/oidc';
    process.env.OIDC_COOKIE_KEYS = 'integration-test-cookie-key';

    dataSource = new DataSource({
      ...AppDataSource.options,
      entities: [],
      ssl: buildSslConfig(
        process.env.DB_SSL,
        process.env.DB_SSL_REJECT_UNAUTHORIZED,
        process.env.DB_SSL_CA,
      ),
    } as DataSource['options']);

    await dataSource.initialize();
    await dataSource.runMigrations();

    const tenants = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO tenant (name, slug, status)
       VALUES ($1, $2, 'active')
       RETURNING id`,
      ['OIDC Integration Tenant', `oidc-it-${Date.now()}`],
    );
    tenantId = tenants[0].id;

    clientId = `oidc-it-client-${randomUUID()}`;
    const clientSecretHash = await hash(clientSecret, { type: argon2i });

    await dataSource.query(
      `INSERT INTO oauth_client (
         tenant_id, client_id, client_secret_hash, name, scopes, grant_types
       ) VALUES ($1, $2, $3, 'Integration Test Client', $4, $5)`,
      [
        tenantId,
        clientId,
        clientSecretHash,
        ['credentials:offer'],
        ['client_credentials'],
      ],
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PgBossService)
      .useValue({
        boss: mockBoss,
        initializeBoss: jest.fn().mockResolvedValue(mockBoss),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    OidcMountService.mount(app);
    await app.init();
  }, 30000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }

    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }

    rmSync(keysDir, { recursive: true, force: true });
  });

  it('issues an RS256 access token verifiable via /oidc/jwks with tenant_id + scope claims', async () => {
    const { token, payload } = await issueTokenAndVerify(
      app.getHttpServer(),
      clientId,
      clientSecret,
      'credentials:offer',
      process.env.OIDC_ISSUER,
    );

    expect(token.accessToken).toEqual(expect.any(String));
    expect(token.tokenType).toBe('Bearer');
    expect(token.expiresIn).toBe(5 * 60);

    expect(payload.tenant_id).toBe(tenantId);
    expect(payload.scope).toBe('credentials:offer');
    expect(payload.aud).toBe('https://digital-trust-common-service');
    expect(payload.iat).toEqual(expect.any(Number));
    expect(payload.exp).toEqual(expect.any(Number));
    expect(
      (payload.exp as number) - (payload.iat as number),
    ).toBeLessThanOrEqual(5 * 60);
  });

  it('rejects an invalid client secret', async () => {
    await request(app.getHttpServer())
      .post('/oidc/token')
      .set('Authorization', buildBasicAuthHeader(clientId, 'wrong-secret'))
      .type('form')
      .send({ grant_type: 'client_credentials' })
      .expect(401);
  });

  /**
   * AU-08 (#41) requires that machine clients get an access token only, with
   * no refresh token, per RFC 6749 §4.4.3 ("A refresh token SHOULD NOT be
   * included"). A client can always re-authenticate with its own credentials,
   * so a refresh token would be a longer-lived secret with no added benefit.
   */
  it('does not issue a refresh token for the client_credentials grant', async () => {
    const response = await request(app.getHttpServer())
      .post('/oidc/token')
      .set('Authorization', buildBasicAuthHeader(clientId, clientSecret))
      .type('form')
      .send({ grant_type: 'client_credentials', scope: 'credentials:offer' })
      .expect(200);

    const body = response.body as Record<string, unknown>;

    expect(body.access_token).toEqual(expect.any(String));
    expect(body).not.toHaveProperty('refresh_token');
  });

  it('does not persist a RefreshToken record for a machine client', async () => {
    await request(app.getHttpServer())
      .post('/oidc/token')
      .set('Authorization', buildBasicAuthHeader(clientId, clientSecret))
      .type('form')
      .send({ grant_type: 'client_credentials', scope: 'credentials:offer' })
      .expect(200);

    // Scoped to this client rather than counting every RefreshToken row: the
    // integration tier shares one database, so a global count asserts that no
    // *other* spec issued a refresh token, which is not what this test is about
    // and breaks the moment one legitimately does.
    const rows = await dataSource.query<Array<{ count: string }>>(
      `SELECT COUNT(*)::text AS count
         FROM oidc_model
        WHERE model_name = 'RefreshToken'
          AND payload ->> 'clientId' = $1`,
      [clientId],
    );

    expect(Number(rows[0]?.count ?? 0)).toBe(0);
  });

  /**
   * The refresh_token grant is listed as serviceable so oidc-provider can
   * consume refresh tokens once AU-02 (#35) issues them, but a machine client
   * must not be able to ask for one directly.
   */
  it('rejects a refresh_token grant request from a client_credentials client', async () => {
    const response = await request(app.getHttpServer())
      .post('/oidc/token')
      .set('Authorization', buildBasicAuthHeader(clientId, clientSecret))
      .type('form')
      .send({ grant_type: 'refresh_token', refresh_token: 'not-a-real-token' });

    expect(response.status).toBeGreaterThanOrEqual(400);

    const body = response.body as {
      error?: string;
      error_description?: string;
    };

    // The grant itself is registered (a missing grant would answer
    // `unsupported_grant_type`); it is this client that may not use it.
    expect(body.error).not.toBe('unsupported_grant_type');
    expect(body.error_description).toBe(
      'requested grant type is not allowed for this client',
    );
  });
});
