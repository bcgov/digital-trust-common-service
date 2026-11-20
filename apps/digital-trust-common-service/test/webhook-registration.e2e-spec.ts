import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OidcMountService } from '@app/oidc';
import { PgBossService } from '@app/pg-boss';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { argon2i, hash } from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { In, Repository } from 'typeorm';

import { configureApp } from '../src/app.config';
import { AppModule } from '../src/app.module';
import { API_BASE_PATH } from '../src/common/constants/api-version.constants';
import { OAuthClient } from '../src/oauth-client/oauth-client.entity';
import { Tenant, TenantStatus } from '../src/tenant/tenant.entity';
import { WebhookRegistration } from '../src/webhook-dispatch/webhook-registration.entity';
import { WebhookEvent } from '../src/webhook-dispatch/webhook-registration.enums';

import { issueTokenAndVerify } from './support/oidc-test-helpers';

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
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

describe('Webhook registration API (e2e)', () => {
  let app: INestApplication<App>;
  let tenantRepo: Repository<Tenant>;
  let oauthClientRepo: Repository<OAuthClient>;
  let webhookRepo: Repository<WebhookRegistration>;
  let keysDir: string;
  let listenPort: number;
  let tenantId: string;
  let otherTenantId: string;
  let managerClientId: string;
  let limitedClientId: string;
  let otherTenantClientId: string;

  const managerClientSecret = randomUUID();
  const limitedClientSecret = randomUUID();
  const otherTenantClientSecret = randomUUID();

  const mockBoss = {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
    createQueue: jest.fn().mockResolvedValue(undefined),
    schedule: jest.fn().mockResolvedValue(undefined),
    work: jest.fn().mockResolvedValue('worker-1'),
  };

  const pgBossService = {
    boss: mockBoss,
    initializeBoss: jest.fn().mockResolvedValue(mockBoss),
    stop: jest.fn().mockResolvedValue(undefined),
    isRunning: jest.fn().mockReturnValue(true),
  };

  const previousEnv = {
    OIDC_KEYS_PATH: process.env.OIDC_KEYS_PATH,
    APP_PUBLIC_URL: process.env.APP_PUBLIC_URL,
    OIDC_COOKIE_KEYS: process.env.OIDC_COOKIE_KEYS,
    JWT_JWKS_URI: process.env.JWT_JWKS_URI,
  };

  const webhooksPath = (id: string): string =>
    `${API_BASE_PATH}/tenants/${id}/webhooks`;

  beforeAll(async () => {
    listenPort = await getFreePort();
    keysDir = mkdtempSync(join(tmpdir(), 'webhook-registration-e2e-'));
    process.env.OIDC_KEYS_PATH = join(keysDir, 'oidc-keys.json');
    process.env.APP_PUBLIC_URL = `http://127.0.0.1:${listenPort}`;
    process.env.OIDC_COOKIE_KEYS = 'webhook-registration-e2e-cookie-key';
    process.env.JWT_JWKS_URI = `http://127.0.0.1:${listenPort}/oidc/jwks`;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PgBossService)
      .useValue(pgBossService)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    OidcMountService.mount(app);
    await app.init();
    await app.listen(listenPort, '127.0.0.1');

    tenantRepo = moduleFixture.get(getRepositoryToken(Tenant));
    oauthClientRepo = moduleFixture.get(getRepositoryToken(OAuthClient));
    webhookRepo = moduleFixture.get(getRepositoryToken(WebhookRegistration));
  }, 30_000);

  beforeEach(async () => {
    const tenant = await tenantRepo.save(
      tenantRepo.create({
        name: 'Webhook E2E tenant',
        slug: `webhook-e2e-${randomUUID()}`,
        status: TenantStatus.ACTIVE,
      }),
    );
    tenantId = tenant.id;

    const otherTenant = await tenantRepo.save(
      tenantRepo.create({
        name: 'Webhook E2E other tenant',
        slug: `webhook-e2e-other-${randomUUID()}`,
        status: TenantStatus.ACTIVE,
      }),
    );
    otherTenantId = otherTenant.id;

    managerClientId = `webhook-manager-${randomUUID()}`;
    limitedClientId = `webhook-limited-${randomUUID()}`;
    otherTenantClientId = `webhook-other-${randomUUID()}`;

    await oauthClientRepo.save([
      oauthClientRepo.create({
        tenantId,
        clientId: managerClientId,
        clientSecretHash: await hash(managerClientSecret, { type: argon2i }),
        name: 'Webhook manager client',
        scopes: ['webhooks:manage'],
        grantTypes: ['client_credentials'],
      }),
      oauthClientRepo.create({
        tenantId,
        clientId: limitedClientId,
        clientSecretHash: await hash(limitedClientSecret, { type: argon2i }),
        name: 'Webhook limited client',
        scopes: ['credentials:offer'],
        grantTypes: ['client_credentials'],
      }),
      oauthClientRepo.create({
        tenantId: otherTenantId,
        clientId: otherTenantClientId,
        clientSecretHash: await hash(otherTenantClientSecret, {
          type: argon2i,
        }),
        name: 'Webhook other tenant client',
        scopes: ['webhooks:manage'],
        grantTypes: ['client_credentials'],
      }),
    ]);
  });

  afterEach(async () => {
    if (!tenantRepo || !oauthClientRepo || !webhookRepo) return;
    const tenantIds = [tenantId, otherTenantId];
    await webhookRepo.delete({ tenantId: In(tenantIds) });
    await oauthClientRepo.delete({ tenantId: In(tenantIds) });
    await tenantRepo.delete({ id: In(tenantIds) });
  });

  afterAll(async () => {
    if (app) await app.close();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (keysDir) rmSync(keysDir, { recursive: true, force: true });
  });

  async function accessToken(
    clientId: string,
    secret: string,
    scope: string,
  ): Promise<string> {
    const { token } = await issueTokenAndVerify(
      app.getHttpServer(),
      clientId,
      secret,
      scope,
      `${process.env.APP_PUBLIC_URL}/oidc`,
    );
    return token.accessToken;
  }

  async function managerToken(): Promise<string> {
    return accessToken(managerClientId, managerClientSecret, 'webhooks:manage');
  }

  it('creates a registration, returns the secret once with no-store, and never lists it', async () => {
    const token = await managerToken();
    const response = await request(app.getHttpServer())
      .post(webhooksPath(tenantId))
      .set('Authorization', `Bearer ${token}`)
      .send({
        endpoint_url: 'https://93.184.216.34/events',
        events: [WebhookEvent.CREDENTIAL_ISSUED],
      })
      .expect(201)
      .expect('cache-control', 'no-store');

    const body = response.body as { id: string; signing_secret: string };
    expect(body).toMatchObject({
      tenant_id: tenantId,
      endpoint_url: 'https://93.184.216.34/events',
      events: [WebhookEvent.CREDENTIAL_ISSUED],
      status: 'active',
    });
    expect(body.signing_secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body).not.toHaveProperty('credentials_encrypted');
    expect(body).not.toHaveProperty('key_version');

    const listed = await request(app.getHttpServer())
      .get(webhooksPath(tenantId))
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const registrations = listed.body as Array<{ id: string }>;
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({
      id: body.id,
      tenant_id: tenantId,
      status: 'active',
    });
    expect(registrations[0]).not.toHaveProperty('signing_secret');
    expect(JSON.stringify(registrations)).not.toContain(body.signing_secret);
  });

  it('requires webhooks:manage for each operation', async () => {
    const token = await accessToken(
      limitedClientId,
      limitedClientSecret,
      'credentials:offer',
    );
    const route = webhooksPath(tenantId);
    const created = await request(app.getHttpServer())
      .post(route)
      .set('Authorization', `Bearer ${token}`)
      .send({
        endpoint_url: 'https://93.184.216.34/events',
        events: [WebhookEvent.CREDENTIAL_ISSUED],
      })
      .expect(403);
    const body = created.body as { error: { code: string } };
    expect(body.error.code).toBe('INSUFFICIENT_SCOPE');

    await request(app.getHttpServer())
      .get(route)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    await request(app.getHttpServer())
      .delete(`${route}/${randomUUID()}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('blocks cross-tenant access and keeps foreign registrations indistinguishable from missing ones', async () => {
    const ownToken = await managerToken();
    const otherToken = await accessToken(
      otherTenantClientId,
      otherTenantClientSecret,
      'webhooks:manage',
    );
    const created = await request(app.getHttpServer())
      .post(webhooksPath(otherTenantId))
      .set('Authorization', `Bearer ${otherToken}`)
      .send({
        endpoint_url: 'https://93.184.216.34/other',
        events: [WebhookEvent.CONNECTION_ESTABLISHED],
      })
      .expect(201);
    const { id } = created.body as { id: string };

    await request(app.getHttpServer())
      .get(webhooksPath(otherTenantId))
      .set('Authorization', `Bearer ${ownToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .delete(`${webhooksPath(tenantId)}/${id}`)
      .set('Authorization', `Bearer ${ownToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .delete(`${webhooksPath(otherTenantId)}/${id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(204);
  });

  it('rejects private destinations and malformed subscriptions before persistence', async () => {
    const token = await managerToken();
    const route = webhooksPath(tenantId);

    await request(app.getHttpServer())
      .post(route)
      .set('Authorization', `Bearer ${token}`)
      .send({
        endpoint_url: 'https://10.0.0.8/events',
        events: [WebhookEvent.CREDENTIAL_ISSUED],
      })
      .expect(422);
    await request(app.getHttpServer())
      .post(route)
      .set('Authorization', `Bearer ${token}`)
      .send({
        endpoint_url: 'https://93.184.216.34/events',
        events: ['unsupported.event'],
      })
      .expect(400);

    await expect(webhookRepo.count({ where: { tenantId } })).resolves.toBe(0);
  });

  it('deletes a registration and returns an empty list afterward', async () => {
    const token = await managerToken();
    const route = webhooksPath(tenantId);
    const created = await request(app.getHttpServer())
      .post(route)
      .set('Authorization', `Bearer ${token}`)
      .send({
        endpoint_url: 'https://93.184.216.34/events',
        events: [WebhookEvent.CREDENTIAL_ISSUED],
      })
      .expect(201);
    const { id } = created.body as { id: string };

    await request(app.getHttpServer())
      .delete(`${route}/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    await request(app.getHttpServer())
      .get(route)
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect([]);
  });
});
