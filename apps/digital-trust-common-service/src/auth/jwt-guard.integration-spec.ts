import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { createServer } from 'http';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  JwtGuard,
  RequireScopes,
  ScopeGuard,
  TenantGuard,
  AuthModule,
} from '@app/auth';
import { AppDataSource } from '@app/database/data-source';
import { buildSslConfig } from '@app/database/ssl.util';
import { OidcMountService } from '@app/oidc';
import { PgBossService } from '@app/pg-boss';
import {
  Controller,
  Get,
  INestApplication,
  Module,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { hash, argon2i } from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { issueTokenAndVerify } from '../../test/support/oidc-test-helpers';
import { configureApp } from '../app.config';
import { AppModule } from '../app.module';
import {
  API_BASE_PATH,
  API_VERSION,
} from '../common/constants/api-version.constants';

/**
 * Registered only in this integration module to exercise @RequireScopes without
 * rolling guards out to product controllers (#165).
 */
@Controller({ path: 'integration/scope-check', version: API_VERSION })
@UseGuards(JwtGuard, ScopeGuard)
class ScopeCheckIntegrationController {
  @Get('offer')
  @RequireScopes('credentials:offer')
  public checkOfferScope(): { ok: true } {
    return { ok: true };
  }
}

/**
 * Registered only here to exercise TenantGuard claim-match (AU-05) without
 * rolling guards onto product controllers (#165).
 */
@Controller({ path: 'integration/tenant-check', version: API_VERSION })
@UseGuards(JwtGuard, ScopeGuard, TenantGuard)
class TenantCheckIntegrationController {
  @Get(':tenantId')
  public checkTenant(
    @Param('tenantId') tenantId: string,
    @Req() req: { tenantId?: string },
  ): { ok: true; tenantId: string; resolvedTenantId?: string } {
    return {
      ok: true,
      tenantId,
      resolvedTenantId: req.tenantId,
    };
  }
}

@Module({
  imports: [AuthModule],
  controllers: [
    ScopeCheckIntegrationController,
    TenantCheckIntegrationController,
  ],
})
class AuthGuardIntegrationModule {}

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

describe('JwtGuard, ScopeGuard, and TenantGuard (integration)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let keysDir: string;
  let listenPort: number;
  let tenantId: string;
  let otherTenantId: string;
  let tenantClientId: string;
  let otherTenantClientId: string;
  let platformAdminClientId: string;
  let logsReadClientId: string;
  let tenantSuperuserClientId: string;
  const tenantClientSecret = 'jwt-guard-integration-secret';
  const otherTenantClientSecret = 'jwt-guard-other-tenant-secret';
  const platformAdminClientSecret = 'platform-admin-integration-secret';
  const logsReadClientSecret = 'logs-read-integration-secret';
  const tenantSuperuserClientSecret = 'tenant-superuser-integration-secret';

  const scopeCheckPath = `${API_BASE_PATH}/integration/scope-check/offer`;
  const tenantCheckPath = (id: string): string =>
    `${API_BASE_PATH}/integration/tenant-check/${id}`;

  const mockBoss = {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
    createQueue: jest.fn().mockResolvedValue(undefined),
    schedule: jest.fn().mockResolvedValue(undefined),
    work: jest.fn().mockResolvedValue('worker-1'),
  };

  beforeAll(async () => {
    listenPort = await getFreePort();
    keysDir = mkdtempSync(join(tmpdir(), 'jwt-guard-it-'));
    process.env.OIDC_KEYS_PATH = join(keysDir, 'oidc-keys.json');
    process.env.OIDC_ISSUER = `http://127.0.0.1:${listenPort}/oidc`;
    process.env.OIDC_COOKIE_KEYS = 'jwt-guard-integration-cookie-key';
    process.env.JWT_JWKS_URI = `http://127.0.0.1:${listenPort}/oidc/jwks`;

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
      ['JWT Guard Tenant', `jwt-guard-${Date.now()}`],
    );
    tenantId = tenants[0].id;

    const otherTenants = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO tenant (name, slug, status)
       VALUES ($1, $2, 'active')
       RETURNING id`,
      ['JWT Guard Other Tenant', `jwt-guard-other-${Date.now()}`],
    );
    otherTenantId = otherTenants[0].id;

    tenantClientId = `jwt-guard-client-${randomUUID()}`;
    otherTenantClientId = `jwt-guard-other-client-${randomUUID()}`;
    platformAdminClientId = `platform-admin-client-${randomUUID()}`;
    const tenantClientSecretHash = await hash(tenantClientSecret, {
      type: argon2i,
    });
    const platformAdminSecretHash = await hash(platformAdminClientSecret, {
      type: argon2i,
    });

    await dataSource.query(
      `INSERT INTO oauth_client (
         tenant_id, client_id, client_secret_hash, name, scopes, grant_types, roles
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tenantId,
        tenantClientId,
        tenantClientSecretHash,
        'JWT Guard Integration Client',
        ['credentials:offer'],
        ['client_credentials'],
        [],
      ],
    );

    const otherTenantClientSecretHash = await hash(otherTenantClientSecret, {
      type: argon2i,
    });

    await dataSource.query(
      `INSERT INTO oauth_client (
         tenant_id, client_id, client_secret_hash, name, scopes, grant_types, roles
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        otherTenantId,
        otherTenantClientId,
        otherTenantClientSecretHash,
        'JWT Guard Other Tenant Client',
        ['credentials:offer'],
        ['client_credentials'],
        [],
      ],
    );

    await dataSource.query(
      `INSERT INTO oauth_client (
         tenant_id, client_id, client_secret_hash, name, scopes, grant_types, roles
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tenantId,
        platformAdminClientId,
        platformAdminSecretHash,
        'Platform Admin Integration Client',
        ['credentials:offer'],
        ['client_credentials'],
        ['platform-admin'],
      ],
    );

    logsReadClientId = `logs-read-client-${randomUUID()}`;
    tenantSuperuserClientId = `tenant-superuser-client-${randomUUID()}`;
    const logsReadSecretHash = await hash(logsReadClientSecret, {
      type: argon2i,
    });
    const tenantSuperuserSecretHash = await hash(tenantSuperuserClientSecret, {
      type: argon2i,
    });

    await dataSource.query(
      `INSERT INTO oauth_client (
         tenant_id, client_id, client_secret_hash, name, scopes, grant_types, roles
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tenantId,
        logsReadClientId,
        logsReadSecretHash,
        'Logs Read Integration Client',
        ['logs:read'],
        ['client_credentials'],
        [],
      ],
    );

    await dataSource.query(
      `INSERT INTO oauth_client (
         tenant_id, client_id, client_secret_hash, name, scopes, grant_types, roles
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tenantId,
        tenantSuperuserClientId,
        tenantSuperuserSecretHash,
        'Tenant Superuser Integration Client',
        ['tenants:admin'],
        ['client_credentials'],
        [],
      ],
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, AuthGuardIntegrationModule],
    })
      .overrideProvider(PgBossService)
      .useValue({
        boss: mockBoss,
        initializeBoss: jest.fn().mockResolvedValue(mockBoss),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    OidcMountService.mount(app);
    await app.init();
    await app.listen(listenPort, '127.0.0.1');
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

  it('returns 401 without a bearer token and includes WWW-Authenticate', async () => {
    const response = await request(app.getHttpServer())
      .get(`${API_BASE_PATH}/admin/operations/stats`)
      .expect(401);

    expect(response.headers['www-authenticate']).toMatch(/Bearer error="/);
    expect(response.body).toMatchObject({
      error: { code: 'AUTHENTICATION_REQUIRED' },
    });
  });

  it('returns 403 when a valid token lacks the platform-admin role', async () => {
    const { token } = await issueTokenAndVerify(
      app.getHttpServer(),
      tenantClientId,
      tenantClientSecret,
      'credentials:offer',
      process.env.OIDC_ISSUER,
    );

    const response = await request(app.getHttpServer())
      .get(`${API_BASE_PATH}/admin/operations/stats`)
      .set('Authorization', `Bearer ${token.accessToken}`)
      .expect(403);

    expect(response.body).toMatchObject({
      error: {
        code: 'INSUFFICIENT_SCOPE',
        required_roles: ['platform-admin'],
      },
    });
  });

  it('allows a platform-admin token through ScopeGuard', async () => {
    const { token } = await issueTokenAndVerify(
      app.getHttpServer(),
      platformAdminClientId,
      platformAdminClientSecret,
      'credentials:offer',
      process.env.OIDC_ISSUER,
    );

    await request(app.getHttpServer())
      .get(`${API_BASE_PATH}/admin/operations/stats`)
      .set('Authorization', `Bearer ${token.accessToken}`)
      .expect(200);
  });

  it('returns 401 for a tampered bearer token', async () => {
    const { token } = await issueTokenAndVerify(
      app.getHttpServer(),
      tenantClientId,
      tenantClientSecret,
      'credentials:offer',
      process.env.OIDC_ISSUER,
    );

    const [header, payload] = token.accessToken.split('.');
    const tamperedToken = `${header}.${payload}.invalid-signature`;

    const response = await request(app.getHttpServer())
      .get(`${API_BASE_PATH}/admin/operations/stats`)
      .set('Authorization', `Bearer ${tamperedToken}`)
      .expect(401);

    expect(response.body).toMatchObject({
      error: { code: 'AUTHENTICATION_REQUIRED' },
    });
  });

  it('allows a token with the required scope through @RequireScopes', async () => {
    const { token } = await issueTokenAndVerify(
      app.getHttpServer(),
      tenantClientId,
      tenantClientSecret,
      'credentials:offer',
      process.env.OIDC_ISSUER,
    );

    await request(app.getHttpServer())
      .get(scopeCheckPath)
      .set('Authorization', `Bearer ${token.accessToken}`)
      .expect(200)
      .expect({ ok: true });
  });

  it('returns 403 when @RequireScopes is not satisfied', async () => {
    const { token } = await issueTokenAndVerify(
      app.getHttpServer(),
      logsReadClientId,
      logsReadClientSecret,
      'logs:read',
      process.env.OIDC_ISSUER,
    );

    const response = await request(app.getHttpServer())
      .get(scopeCheckPath)
      .set('Authorization', `Bearer ${token.accessToken}`)
      .expect(403);

    expect(response.body).toMatchObject({
      error: {
        code: 'INSUFFICIENT_SCOPE',
        required_scopes: ['credentials:offer'],
      },
    });
  });

  it('grants Level 2 scopes when the token has tenants:admin', async () => {
    const { token } = await issueTokenAndVerify(
      app.getHttpServer(),
      tenantSuperuserClientId,
      tenantSuperuserClientSecret,
      'tenants:admin',
      process.env.OIDC_ISSUER,
    );

    await request(app.getHttpServer())
      .get(scopeCheckPath)
      .set('Authorization', `Bearer ${token.accessToken}`)
      .expect(200)
      .expect({ ok: true });
  });

  it('allows a client token for its own tenant through TenantGuard', async () => {
    const { token } = await issueTokenAndVerify(
      app.getHttpServer(),
      tenantClientId,
      tenantClientSecret,
      'credentials:offer',
      process.env.OIDC_ISSUER,
    );

    const response = await request(app.getHttpServer())
      .get(tenantCheckPath(tenantId))
      .set('Authorization', `Bearer ${token.accessToken}`)
      .expect(200);

    expect(response.body).toEqual({
      ok: true,
      tenantId,
      resolvedTenantId: tenantId,
    });
  });

  it('returns 403 when a client for tenant A accesses tenant B', async () => {
    const { token } = await issueTokenAndVerify(
      app.getHttpServer(),
      tenantClientId,
      tenantClientSecret,
      'credentials:offer',
      process.env.OIDC_ISSUER,
    );

    const response = await request(app.getHttpServer())
      .get(tenantCheckPath(otherTenantId))
      .set('Authorization', `Bearer ${token.accessToken}`)
      .expect(403);

    expect(response.body).toMatchObject({
      error: {
        code: 'TENANT_ACCESS_DENIED',
        required_tenant_id: otherTenantId,
        token_tenant_id: tenantId,
      },
    });
  });

  it('returns 403 when a client for tenant B accesses tenant A', async () => {
    const { token } = await issueTokenAndVerify(
      app.getHttpServer(),
      otherTenantClientId,
      otherTenantClientSecret,
      'credentials:offer',
      process.env.OIDC_ISSUER,
    );

    const response = await request(app.getHttpServer())
      .get(tenantCheckPath(tenantId))
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

  it('allows platform-admin to access another tenant through TenantGuard', async () => {
    const { token } = await issueTokenAndVerify(
      app.getHttpServer(),
      platformAdminClientId,
      platformAdminClientSecret,
      'credentials:offer',
      process.env.OIDC_ISSUER,
    );

    const response = await request(app.getHttpServer())
      .get(tenantCheckPath(otherTenantId))
      .set('Authorization', `Bearer ${token.accessToken}`)
      .expect(200);

    expect(response.body).toEqual({
      ok: true,
      tenantId: otherTenantId,
      resolvedTenantId: otherTenantId,
    });
  });
});
