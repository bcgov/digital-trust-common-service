import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { OidcMountService } from '@app/oidc';
import { PgBossService } from '@app/pg-boss';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { hash, argon2i } from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';

import { AppModule } from '../src/app.module';
import { OAuthClient } from '../src/oauth-client/oauth-client.entity';
import { Tenant, TenantStatus } from '../src/tenant/tenant.entity';

import {
  buildBasicAuthHeader,
  issueTokenAndVerify,
} from './support/oidc-test-helpers';

/**
 * Black-box e2e coverage of AU-01's client_credentials flow (issue #34),
 * exercised through the full HTTP stack exactly as it is bootstrapped in
 * production (`main.ts`: `OidcMountService.mount(app)` before `app.init()`).
 *
 * This complements (rather than duplicates) the component-level
 * `oidc-client-credentials.integration-spec.ts`: that spec is the AC's
 * required "obtain token via client_credentials, validate via JWKS" proof
 * and seeds test data via raw SQL against a standalone `DataSource`; this
 * e2e spec instead seeds through the app's own TypeORM repositories (the
 * same pattern used by `admin-operations.e2e-spec.ts` /
 * `operation-lifecycle.e2e-spec.ts`) and runs under the repo's dedicated
 * e2e Jest project/config (`npm run test:e2e`), which is also what
 * guarantees `OidcModule`'s wiring into `AppModule` doesn't regress the
 * rest of the app's e2e suite (it previously broke `jest-e2e.json`'s
 * ability to even parse ESM-only `jose`/`oidc-provider` dependencies).
 */
describe('OIDC client_credentials grant (e2e)', () => {
  let app: INestApplication<App>;
  let tenantRepo: Repository<Tenant>;
  let oauthClientRepo: Repository<OAuthClient>;
  let tenantId: string;
  let clientId: string;
  const clientSecret = 'a-very-secret-e2e-value';

  const mockBoss = {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
    createQueue: jest.fn().mockResolvedValue(undefined),
    schedule: jest.fn().mockResolvedValue(undefined),
    work: jest.fn().mockResolvedValue('worker-1'),
  };

  let keysDir: string;

  beforeAll(async () => {
    // Use an isolated, throwaway JWKS path rather than the shared dev
    // default (`./config/oidc-keys.json`) so this suite never leaves a
    // generated key file behind or interferes with other suites/local dev.
    keysDir = mkdtempSync(join(tmpdir(), 'oidc-e2e-'));
    process.env.OIDC_KEYS_PATH = join(keysDir, 'oidc-keys.json');

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
    // Mount before init(), mirroring main.ts: Express middleware registered
    // after Nest's router is initialized is unreachable (see oidc-mount
    // .service.ts for the full explanation of this ordering requirement).
    OidcMountService.mount(app);
    await app.init();

    tenantRepo = moduleFixture.get(getRepositoryToken(Tenant));
    oauthClientRepo = moduleFixture.get(getRepositoryToken(OAuthClient));
  });

  beforeEach(async () => {
    const tenant = await tenantRepo.save(
      tenantRepo.create({
        name: 'OIDC e2e Tenant',
        slug: `oidc-e2e-${randomUUID()}`,
        status: TenantStatus.ACTIVE,
      }),
    );
    tenantId = tenant.id;

    clientId = `oidc-e2e-client-${randomUUID()}`;
    const clientSecretHash = await hash(clientSecret, { type: argon2i });

    await oauthClientRepo.save(
      oauthClientRepo.create({
        tenantId,
        clientId,
        clientSecretHash,
        name: 'E2E Test Client',
        scopes: ['credentials:offer'],
        grantTypes: ['client_credentials'],
      }),
    );
  });

  afterEach(async () => {
    await oauthClientRepo.query('DELETE FROM oauth_client');
    await tenantRepo.query('DELETE FROM tenant');
  });

  afterAll(async () => {
    await app.close();
    delete process.env.OIDC_KEYS_PATH;
    rmSync(keysDir, { recursive: true, force: true });
  });

  it('issues a JWT access token via /oidc/token that verifies against /oidc/jwks', async () => {
    const { token, payload } = await issueTokenAndVerify(
      app.getHttpServer(),
      clientId,
      clientSecret,
      'credentials:offer',
    );

    expect(token.tokenType).toBe('Bearer');
    expect(token.accessToken).toEqual(expect.any(String));
    expect(payload.tenant_id).toBe(tenantId);
    expect(payload.scope).toBe('credentials:offer');
  });

  it('rejects client_credentials requests with an invalid client secret', async () => {
    await request(app.getHttpServer())
      .post('/oidc/token')
      .set('Authorization', buildBasicAuthHeader(clientId, 'wrong-secret'))
      .type('form')
      .send({ grant_type: 'client_credentials' })
      .expect(401);
  });

  it('rejects requests for a client_id that does not exist', async () => {
    await request(app.getHttpServer())
      .post('/oidc/token')
      .set(
        'Authorization',
        buildBasicAuthHeader('no-such-client', clientSecret),
      )
      .type('form')
      .send({ grant_type: 'client_credentials' })
      .expect(401);
  });

  it('rejects a revoked client even with the correct secret', async () => {
    await oauthClientRepo.update({ clientId }, { revokedAt: new Date() });

    await request(app.getHttpServer())
      .post('/oidc/token')
      .set('Authorization', buildBasicAuthHeader(clientId, clientSecret))
      .type('form')
      .send({ grant_type: 'client_credentials' })
      .expect(401);
  });

  it('rejects a scope the client was not granted, rather than silently issuing it', async () => {
    // The seeded client only has `credentials:offer`; requesting a scope
    // outside that allowlist must not silently succeed with the extra
    // scope granted (OAuthClient.scopes is the source of truth for what a
    // given client may act as, see OidcClientAdapter/client_schema.js).
    const response = await request(app.getHttpServer())
      .post('/oidc/token')
      .set('Authorization', buildBasicAuthHeader(clientId, clientSecret))
      .type('form')
      .send({
        grant_type: 'client_credentials',
        scope: 'credentials:offer credentials:verify',
      })
      .expect(400);

    const body = response.body as { error: string };

    expect(body.error).toBe('invalid_scope');
  });

  it('rejects a grant_type the client is not authorized for', async () => {
    await oauthClientRepo.update({ clientId }, { grantTypes: [] });

    const response = await request(app.getHttpServer())
      .post('/oidc/token')
      .set('Authorization', buildBasicAuthHeader(clientId, clientSecret))
      .type('form')
      .send({ grant_type: 'client_credentials' })
      .expect(400);

    const body = response.body as { error: string; error_description: string };

    // oidc-provider's `allowedGrantTypeCheck` (token.js) throws
    // `InvalidRequest`, not `unauthorized_client`, when a client's own
    // `grant_types` metadata doesn't permit the requested grant, so this
    // asserts the actual library behavior rather than the OAuth error code
    // one might otherwise assume applies here.
    expect(body.error).toBe('invalid_request');
    expect(body.error_description).toBe(
      'requested grant type is not allowed for this client',
    );
  });

  it('exposes OIDC discovery metadata at the well-known endpoint', async () => {
    const response = await request(app.getHttpServer())
      .get('/oidc/.well-known/openid-configuration')
      .expect(200);

    const body = response.body as { token_endpoint: string; jwks_uri: string };

    expect(body.token_endpoint).toContain('/oidc/token');
    expect(body.jwks_uri).toContain('/oidc/jwks');
  });

  it('never exposes private key material at /oidc/jwks', async () => {
    const jwksResponse = await request(app.getHttpServer())
      .get('/oidc/jwks')
      .expect(200);

    const jwksBody = jwksResponse.body as {
      keys: Array<Record<string, unknown>>;
    };

    expect(jwksBody.keys.length).toBeGreaterThan(0);

    // RSA private-key components. Only the public modulus/exponent (n, e)
    // and metadata (kty, kid, use, alg) should ever be present in a
    // published JWKS. A regression here would leak signing key material.
    const privateComponents = ['d', 'p', 'q', 'dp', 'dq', 'qi'];

    for (const jwk of jwksBody.keys) {
      for (const component of privateComponents) {
        expect(jwk).not.toHaveProperty(component);
      }
    }
  });

  describe('introspection and revocation', () => {
    const issueToken = async (): Promise<string> => {
      const tokenResponse = await request(app.getHttpServer())
        .post('/oidc/token')
        .set('Authorization', buildBasicAuthHeader(clientId, clientSecret))
        .type('form')
        .send({ grant_type: 'client_credentials', scope: 'credentials:offer' })
        .expect(200);

      const tokenBody = tokenResponse.body as { access_token: string };

      return tokenBody.access_token;
    };

    // The provider is configured (oidc-provider.service.ts) to always issue
    // RS256-signed, structured JWT access tokens via `resourceIndicators` /
    // `accessTokenFormat: 'jwt'`. This is what lets resource servers
    // validate tokens locally against `/oidc/jwks` without a network round
    // trip (the whole point of AU-01's AC). oidc-provider's
    // `reject_structured_tokens` middleware (wired into both the
    // introspection and revocation actions) unconditionally rejects any
    // token that decodes as a JWT with `unsupported_token_type`, since
    // self-contained JWT access tokens are meant to be verified via JWKS,
    // not introspected/revoked centrally. Since every access token this
    // service issues is a JWT, these endpoints can never report
    // `active: true` or actually revoke one of our real tokens; these tests
    // document that real, current behavior rather than assuming RFC 7662
    // opaque-token semantics that don't apply here.
    it('rejects introspection of a real (structured JWT) access token with unsupported_token_type', async () => {
      const accessToken = await issueToken();

      const response = await request(app.getHttpServer())
        .post('/oidc/token/introspection')
        .set('Authorization', buildBasicAuthHeader(clientId, clientSecret))
        .type('form')
        .send({ token: accessToken })
        .expect(400);

      const body = response.body as { error: string };

      expect(body.error).toBe('unsupported_token_type');
    });

    it('rejects revocation of a real (structured JWT) access token with unsupported_token_type', async () => {
      const accessToken = await issueToken();

      const response = await request(app.getHttpServer())
        .post('/oidc/token/revocation')
        .set('Authorization', buildBasicAuthHeader(clientId, clientSecret))
        .type('form')
        .send({ token: accessToken })
        .expect(400);

      const body = response.body as { error: string };

      expect(body.error).toBe('unsupported_token_type');
    });

    it('reports a bogus/opaque token as inactive via /oidc/token/introspection', async () => {
      const introspectionResponse = await request(app.getHttpServer())
        .post('/oidc/token/introspection')
        .set('Authorization', buildBasicAuthHeader(clientId, clientSecret))
        .type('form')
        .send({ token: 'not-a-real-token' })
        .expect(200);

      const body = introspectionResponse.body as { active: boolean };

      expect(body.active).toBe(false);
    });

    it('returns 200 when revoking an unknown/opaque token, per RFC 7662 semantics', async () => {
      // RFC 7009 §2.2: the authorization server responds with 200 even if
      // the token was invalid/already revoked/unknown, so as not to leak
      // information about token validity.
      await request(app.getHttpServer())
        .post('/oidc/token/revocation')
        .set('Authorization', buildBasicAuthHeader(clientId, clientSecret))
        .type('form')
        .send({ token: 'not-a-real-token' })
        .expect(200);
    });
  });
});
