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
        ['read:credentials'],
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
      'read:credentials',
      process.env.OIDC_ISSUER,
    );

    expect(token.accessToken).toEqual(expect.any(String));
    expect(token.tokenType).toBe('Bearer');
    expect(token.expiresIn).toBe(5 * 60);

    expect(payload.tenant_id).toBe(tenantId);
    expect(payload.scope).toBe('read:credentials');
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
});
