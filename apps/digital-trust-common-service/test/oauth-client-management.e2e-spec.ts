import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { createServer } from 'http';
import { tmpdir } from 'os';
import { join } from 'path';

import { OidcMountService } from '@app/oidc';
import { PgBossService } from '@app/pg-boss';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { argon2i, hash } from 'argon2';
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
  issueTokenAndVerify,
} from './support/oidc-test-helpers';

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to resolve free port')));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

/**
 * Black-box e2e coverage of AU-06 (API client registration and management).
 * Exercises the nested tenant routes through JwtGuard + ScopeGuard +
 * TenantGuard, then proves a newly registered client can obtain a token
 * via /oidc/token, that rotate-secret invalidates the old secret, and that
 * revoke stops further token grants.
 */
describe('OAuth client management (e2e)', () => {
  let app: INestApplication<App>;
  let tenantRepo: Repository<Tenant>;
  let oauthClientRepo: Repository<OAuthClient>;
  let keysDir: string;
  let listenPort: number;

  let tenantId: string;
  let otherTenantId: string;
  let adminClientId: string;
  let offerOnlyClientId: string;
  let otherTenantClientId: string;

  const adminClientSecret = 'au06-admin-secret';
  const offerOnlyClientSecret = 'au06-offer-secret';
  const otherTenantClientSecret = 'au06-other-tenant-secret';

  const mockBoss = {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
    createQueue: jest.fn().mockResolvedValue(undefined),
    schedule: jest.fn().mockResolvedValue(undefined),
    work: jest.fn().mockResolvedValue('worker-1'),
  };

  const clientsPath = (id: string): string =>
    `${API_BASE_PATH}/tenants/${id}/clients`;

  const previousEnv = {
    OIDC_KEYS_PATH: process.env.OIDC_KEYS_PATH,
    OIDC_ISSUER: process.env.OIDC_ISSUER,
    OIDC_COOKIE_KEYS: process.env.OIDC_COOKIE_KEYS,
    JWT_JWKS_URI: process.env.JWT_JWKS_URI,
  };

  beforeAll(async () => {
    listenPort = await getFreePort();
    keysDir = mkdtempSync(join(tmpdir(), 'oauth-client-e2e-'));
    process.env.OIDC_KEYS_PATH = join(keysDir, 'oidc-keys.json');
    process.env.OIDC_ISSUER = `http://127.0.0.1:${listenPort}/oidc`;
    process.env.OIDC_COOKIE_KEYS = 'oauth-client-e2e-cookie-key';
    process.env.JWT_JWKS_URI = `http://127.0.0.1:${listenPort}/oidc/jwks`;

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
        name: 'AU-06 e2e Tenant',
        slug: `au06-e2e-${randomUUID()}`,
        status: TenantStatus.ACTIVE,
      }),
    );
    tenantId = tenant.id;

    const otherTenant = await tenantRepo.save(
      tenantRepo.create({
        name: 'AU-06 other Tenant',
        slug: `au06-other-${randomUUID()}`,
        status: TenantStatus.ACTIVE,
      }),
    );
    otherTenantId = otherTenant.id;

    adminClientId = `au06-admin-${randomUUID()}`;
    offerOnlyClientId = `au06-offer-${randomUUID()}`;
    otherTenantClientId = `au06-other-${randomUUID()}`;

    await oauthClientRepo.save(
      oauthClientRepo.create({
        tenantId,
        clientId: adminClientId,
        clientSecretHash: await hash(adminClientSecret, { type: argon2i }),
        name: 'AU-06 Admin Client',
        scopes: ['tenants:admin'],
        grantTypes: ['client_credentials'],
      }),
    );
    await oauthClientRepo.save(
      oauthClientRepo.create({
        tenantId,
        clientId: offerOnlyClientId,
        clientSecretHash: await hash(offerOnlyClientSecret, { type: argon2i }),
        name: 'AU-06 Offer-only Client',
        scopes: ['credentials:offer'],
        grantTypes: ['client_credentials'],
      }),
    );
    await oauthClientRepo.save(
      oauthClientRepo.create({
        tenantId: otherTenantId,
        clientId: otherTenantClientId,
        clientSecretHash: await hash(otherTenantClientSecret, {
          type: argon2i,
        }),
        name: 'AU-06 Other Tenant Client',
        scopes: ['clients:manage'],
        grantTypes: ['client_credentials'],
      }),
    );
  });

  afterEach(async () => {
    if (oauthClientRepo) {
      await oauthClientRepo.query('DELETE FROM oauth_client');
    }
    if (tenantRepo) {
      await tenantRepo.query('DELETE FROM tenant');
    }
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }

    process.env.OIDC_KEYS_PATH = previousEnv.OIDC_KEYS_PATH;
    process.env.OIDC_ISSUER = previousEnv.OIDC_ISSUER;
    process.env.OIDC_COOKIE_KEYS = previousEnv.OIDC_COOKIE_KEYS;
    process.env.JWT_JWKS_URI = previousEnv.JWT_JWKS_URI;

    if (previousEnv.OIDC_KEYS_PATH === undefined) {
      delete process.env.OIDC_KEYS_PATH;
    }
    if (previousEnv.OIDC_ISSUER === undefined) {
      delete process.env.OIDC_ISSUER;
    }
    if (previousEnv.OIDC_COOKIE_KEYS === undefined) {
      delete process.env.OIDC_COOKIE_KEYS;
    }
    if (previousEnv.JWT_JWKS_URI === undefined) {
      delete process.env.JWT_JWKS_URI;
    }

    rmSync(keysDir, { recursive: true, force: true });
  });

  async function adminToken(): Promise<string> {
    const { token } = await issueTokenAndVerify(
      app.getHttpServer(),
      adminClientId,
      adminClientSecret,
      'tenants:admin',
      process.env.OIDC_ISSUER,
    );

    return token.accessToken;
  }

  it('returns 401 without a bearer token', async () => {
    const response = await request(app.getHttpServer())
      .get(clientsPath(tenantId))
      .expect(401);

    expect(response.body).toMatchObject({
      error: { code: 'AUTHENTICATION_REQUIRED' },
    });
  });

  it('returns 403 when the token lacks clients:manage', async () => {
    const { token } = await issueTokenAndVerify(
      app.getHttpServer(),
      offerOnlyClientId,
      offerOnlyClientSecret,
      'credentials:offer',
      process.env.OIDC_ISSUER,
    );

    const response = await request(app.getHttpServer())
      .get(clientsPath(tenantId))
      .set('Authorization', `Bearer ${token.accessToken}`)
      .expect(403);

    expect(response.body).toMatchObject({
      error: {
        code: 'INSUFFICIENT_SCOPE',
        required_scopes: ['clients:manage'],
      },
    });
  });

  it('returns 403 when a client for another tenant accesses this tenant', async () => {
    const { token } = await issueTokenAndVerify(
      app.getHttpServer(),
      otherTenantClientId,
      otherTenantClientSecret,
      'clients:manage',
      process.env.OIDC_ISSUER,
    );

    const response = await request(app.getHttpServer())
      .get(clientsPath(tenantId))
      .set('Authorization', `Bearer ${token.accessToken}`)
      .expect(403);

    expect(response.body).toMatchObject({
      error: {
        code: 'TENANT_ACCESS_DENIED',
        required_tenant_id: tenantId,
        token_tenant_id: otherTenantId,
      },
    });
  });

  it('registers a client, lists it without the secret, issues a token, rotates, then revokes', async () => {
    const accessToken = await adminToken();

    const createResponse = await request(app.getHttpServer())
      .post(clientsPath(tenantId))
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Registered Integration Client',
        scopes: ['credentials:offer'],
      })
      .expect(201);

    const created = createResponse.body as {
      client: { client_id: string; scopes: string[]; tenant_id: string };
      client_secret: string;
    };

    expect(created.client.client_id).toMatch(/^dtcs_[0-9a-f]{32}$/);
    expect(created.client.tenant_id).toBe(tenantId);
    expect(created.client.scopes).toEqual(['credentials:offer']);
    expect(created.client_secret).toHaveLength(64);

    const listResponse = await request(app.getHttpServer())
      .get(clientsPath(tenantId))
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const listed = listResponse.body as Array<Record<string, unknown>>;
    const listedCreated = listed.find(
      (row) => row.client_id === created.client.client_id,
    );

    expect(listedCreated).toBeDefined();
    expect(listedCreated).not.toHaveProperty('client_secret');
    expect(listedCreated).not.toHaveProperty('clientSecretHash');

    await issueTokenAndVerify(
      app.getHttpServer(),
      created.client.client_id,
      created.client_secret,
      'credentials:offer',
      process.env.OIDC_ISSUER,
    );

    const rotateResponse = await request(app.getHttpServer())
      .post(
        `${clientsPath(tenantId)}/${created.client.client_id}/rotate-secret`,
      )
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const rotated = rotateResponse.body as { client_secret: string };

    expect(rotated.client_secret).toHaveLength(64);
    expect(rotated.client_secret).not.toBe(created.client_secret);

    await request(app.getHttpServer())
      .post('/oidc/token')
      .set(
        'Authorization',
        buildBasicAuthHeader(created.client.client_id, created.client_secret),
      )
      .type('form')
      .send({ grant_type: 'client_credentials', scope: 'credentials:offer' })
      .expect(401);

    await issueTokenAndVerify(
      app.getHttpServer(),
      created.client.client_id,
      rotated.client_secret,
      'credentials:offer',
      process.env.OIDC_ISSUER,
    );

    await request(app.getHttpServer())
      .delete(`${clientsPath(tenantId)}/${created.client.client_id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .post('/oidc/token')
      .set(
        'Authorization',
        buildBasicAuthHeader(created.client.client_id, rotated.client_secret),
      )
      .type('form')
      .send({ grant_type: 'client_credentials', scope: 'credentials:offer' })
      .expect(401);
  });

  it('rejects assigning a scope the caller does not hold', async () => {
    const { token } = await issueTokenAndVerify(
      app.getHttpServer(),
      otherTenantClientId,
      otherTenantClientSecret,
      'clients:manage',
      process.env.OIDC_ISSUER,
    );

    const response = await request(app.getHttpServer())
      .post(clientsPath(otherTenantId))
      .set('Authorization', `Bearer ${token.accessToken}`)
      .send({
        name: 'Over-privileged Client',
        scopes: ['credentials:offer'],
      })
      .expect(403);

    const body = response.body as { message: string };

    expect(body.message).toContain('Cannot assign scope(s)');
  });
});
