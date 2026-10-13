import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { createServer } from 'http';
import { tmpdir } from 'os';
import { join } from 'path';

import { OidcMountService } from '@app/oidc';
import { DEFAULT_JWT_AUDIENCE } from '@app/oidc/config';
import { PgBossService } from '@app/pg-boss';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { hash, argon2i } from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';

import { configureApp } from '../src/app.config';
import { AppModule } from '../src/app.module';
import { API_BASE_PATH } from '../src/common/constants/api-version.constants';
import { OAuthClient } from '../src/oauth-client/oauth-client.entity';
import { Tenant, TenantStatus } from '../src/tenant/tenant.entity';

import {
  buildBasicAuthHeader,
  verifyTokenAgainstJwks,
} from './support/oidc-test-helpers';

/**
 * Issuance half of the tenant log access token contract
 * (`docs/tenant-log-access-contract.md`, Rules T1, T3–T4, T8 and T12).
 *
 * The log gateway validates these tokens, but only this service can shape
 * them, so the invariants it relies on have to be asserted here: a token
 * minted for the gateway resource carries that audience **alone**, carries
 * the tenant and scope claims the gateway authorizes against, and is
 * rejected by this API. Audience membership is what ordinary JWT validation
 * tests, so a token carrying both audiences would satisfy both validators
 * and erase the separation entirely — single-audience issuance is a security
 * invariant of the contract rather than a property of how oidc-provider
 * happens to mint tokens today.
 *
 * Runs against a listening server rather than the in-process handler: a
 * reachable `/oidc/jwks` is what makes the rejection below attributable to
 * the audience instead of a failed key fetch, and the API-audience token
 * issued from the same client proves the route is otherwise reachable.
 */
const LOG_GATEWAY_AUDIENCE = 'https://log-gateway.e2e.test';

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to resolve a free port')));
        return;
      }

      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

describe('log gateway token issuance (e2e)', () => {
  let app: INestApplication<App>;
  let tenantRepo: Repository<Tenant>;
  let oauthClientRepo: Repository<OAuthClient>;
  let keysDir: string;
  let listenPort: number;
  let issuer: string;
  let tenantId: string;
  let clientId: string;
  const clientSecret = 'log-gateway-e2e-secret';

  const mockBoss = {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
    createQueue: jest.fn().mockResolvedValue(undefined),
    schedule: jest.fn().mockResolvedValue(undefined),
    work: jest.fn().mockResolvedValue('worker-1'),
  };

  async function issueToken(scope: string, resource?: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/oidc/token')
      .set('Authorization', buildBasicAuthHeader(clientId, clientSecret))
      .type('form')
      .send({
        grant_type: 'client_credentials',
        scope,
        ...(resource ? { resource } : {}),
      })
      .expect(200);

    return (response.body as { access_token: string }).access_token;
  }

  beforeAll(async () => {
    listenPort = await getFreePort();
    keysDir = mkdtempSync(join(tmpdir(), 'log-gateway-e2e-'));
    process.env.OIDC_KEYS_PATH = join(keysDir, 'oidc-keys.json');
    process.env.APP_PUBLIC_URL = `http://127.0.0.1:${listenPort}`;
    process.env.JWT_JWKS_URI = `http://127.0.0.1:${listenPort}/oidc/jwks`;
    process.env.JWT_ADDITIONAL_AUDIENCES = LOG_GATEWAY_AUDIENCE;
    issuer = `${process.env.APP_PUBLIC_URL}/oidc`;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PgBossService)
      .useValue({
        boss: mockBoss,
        initializeBoss: jest.fn().mockResolvedValue(mockBoss),
        stop: jest.fn().mockResolvedValue(undefined),
        isRunning: jest.fn().mockReturnValue(true),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    OidcMountService.mount(app);
    await app.init();
    await app.listen(listenPort, '127.0.0.1');

    tenantRepo = moduleFixture.get(getRepositoryToken(Tenant));
    oauthClientRepo = moduleFixture.get(getRepositoryToken(OAuthClient));
  }, 30000);

  beforeEach(async () => {
    const tenant = await tenantRepo.save(
      tenantRepo.create({
        name: 'Log Gateway e2e Tenant',
        slug: `log-gateway-e2e-${randomUUID()}`,
        status: TenantStatus.ACTIVE,
      }),
    );
    tenantId = tenant.id;

    clientId = `log-gateway-e2e-client-${randomUUID()}`;

    await oauthClientRepo.save(
      oauthClientRepo.create({
        tenantId,
        clientId,
        clientSecretHash: await hash(clientSecret, { type: argon2i }),
        name: 'Log Gateway e2e Client',
        scopes: ['logs:read', 'audit:read'],
        grantTypes: ['client_credentials'],
      }),
    );
  });

  afterEach(async () => {
    await oauthClientRepo.delete({ clientId });
    await tenantRepo.delete({ id: tenantId });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }

    delete process.env.OIDC_KEYS_PATH;
    delete process.env.APP_PUBLIC_URL;
    delete process.env.JWT_JWKS_URI;
    delete process.env.JWT_ADDITIONAL_AUDIENCES;
    rmSync(keysDir, { recursive: true, force: true });
  });

  it('mints a log gateway token carrying that audience alone', async () => {
    const accessToken = await issueToken('logs:read', LOG_GATEWAY_AUDIENCE);

    const payload = await verifyTokenAgainstJwks(
      app.getHttpServer(),
      accessToken,
      issuer,
      LOG_GATEWAY_AUDIENCE,
    );

    // T12: a single string, not a one-element array and never a pair — a
    // token listing both audiences would pass membership checks on both
    // validators.
    expect(payload.aud).toBe(LOG_GATEWAY_AUDIENCE);
    expect(Array.isArray(payload.aud)).toBe(false);
  });

  it('stamps the claims the gateway authorizes against', async () => {
    const accessToken = await issueToken('logs:read', LOG_GATEWAY_AUDIENCE);

    const payload = await verifyTokenAgainstJwks(
      app.getHttpServer(),
      accessToken,
      issuer,
      LOG_GATEWAY_AUDIENCE,
    );

    // T3/T4: exactly one tenant, from the claim and nowhere else.
    expect(payload.tenant_id).toBe(tenantId);
    expect(payload.scope).toBe('logs:read');
    // T1: issuer and validity window the gateway validates before anything
    // else, and a subject for attribution.
    expect(payload.iss).toBe(issuer);
    expect(payload.sub).toBe(clientId);
    expect(typeof payload.iat).toBe('number');
    expect(payload.exp).toBeGreaterThan(payload.iat as number);
  });

  it('rejects a log gateway token on the API (T8)', async () => {
    const accessToken = await issueToken('logs:read', LOG_GATEWAY_AUDIENCE);

    const response = await request(app.getHttpServer())
      .get(`${API_BASE_PATH}/tenants/${tenantId}/audit-logs`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);

    expect(response.body).toMatchObject({
      error: { code: 'AUTHENTICATION_REQUIRED' },
    });
  });

  it('accepts an API-audience token from the same client on that route', async () => {
    const accessToken = await issueToken('audit:read');

    const payload = await verifyTokenAgainstJwks(
      app.getHttpServer(),
      accessToken,
      issuer,
      DEFAULT_JWT_AUDIENCE,
    );

    expect(payload.aud).toBe(DEFAULT_JWT_AUDIENCE);

    await request(app.getHttpServer())
      .get(`${API_BASE_PATH}/tenants/${tenantId}/audit-logs`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('refuses a resource indicator that is not configured', async () => {
    await request(app.getHttpServer())
      .post('/oidc/token')
      .set('Authorization', buildBasicAuthHeader(clientId, clientSecret))
      .type('form')
      .send({
        grant_type: 'client_credentials',
        scope: 'logs:read',
        resource: 'https://not-a-configured-gateway.e2e.test',
      })
      .expect(400);
  });
});
