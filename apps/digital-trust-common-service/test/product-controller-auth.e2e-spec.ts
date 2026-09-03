import { JwtGuard, TENANT_SUPERUSER_SCOPE } from '@app/auth';
import { PgBossService } from '@app/pg-boss';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';

import { configureApp } from '../src/app.config';
import { AppModule } from '../src/app.module';
import { API_BASE_PATH } from '../src/common/constants/api-version.constants';
import { Tenant, TenantStatus } from '../src/tenant/tenant.entity';

/**
 * Thin auth-enforcement smoke for product controllers now behind JwtGuard.
 * Happy-path business e2e continues to override guards; wrong-scope /
 * wrong-tenant coverage lives in jwt-guard.integration-spec.ts.
 *
 * A second describe block below covers TenantStatusGuard: with a real
 * (suspended) tenant row and JwtGuard stubbed just enough to attach an
 * authenticated context, ScopeGuard, TenantGuard, and TenantStatusGuard all
 * run for real, so a missing TenantStatusGuard on any of the six affected
 * controllers would surface as a failing 403 assertion here.
 */
describe('product controllers (e2e) — auth enforcement', () => {
  let app: INestApplication<App>;

  const mockBoss = {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
    createQueue: jest.fn().mockResolvedValue(undefined),
    schedule: jest.fn().mockResolvedValue(undefined),
    work: jest.fn().mockResolvedValue(undefined),
  };

  const tenantId = '123e4567-e89b-12d3-a456-426614174001';

  beforeAll(async () => {
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
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it.each([
    ['GET', `${API_BASE_PATH}/tenants/${tenantId}/audit-logs`],
    ['GET', `${API_BASE_PATH}/connections/tenant/${tenantId}`],
    ['GET', `${API_BASE_PATH}/tenants/${tenantId}/clients`],
    ['GET', `${API_BASE_PATH}/tenants/${tenantId}/connectors`],
    ['GET', `${API_BASE_PATH}/credential-definitions/tenant/${tenantId}`],
    [
      'GET',
      `${API_BASE_PATH}/tenants/${tenantId}/operations/123e4567-e89b-12d3-a456-426614174000`,
    ],
  ])('%s %s returns 401 without a bearer token', async (method, path) => {
    const response = await request(app.getHttpServer())
      [method.toLowerCase() as 'get'](path)
      .expect(401);

    expect(response.headers['www-authenticate']).toMatch(/Bearer error="/);
    expect(response.body).toMatchObject({
      error: { code: 'AUTHENTICATION_REQUIRED' },
    });
  });
});

/**
 * Stands in for JwtGuard so each request carries a real, tenant-scoped auth
 * context. ScopeGuard, TenantGuard, and TenantStatusGuard all run for real,
 * so this exercises the actual TenantStatusGuard lookup against a suspended
 * tenant row rather than a per-controller-spec guard override.
 */
class TenantAuthStubGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ auth?: unknown; params?: Record<string, string> }>();

    request.auth = {
      sub: 'e2e-tenant-status-sub',
      tokenType: 'user',
      roles: [],
      scopes: [TENANT_SUPERUSER_SCOPE],
      tenantId: request.params?.tenantId ?? null,
    };

    return true;
  }
}

describe('product controllers (e2e) — tenant status enforcement', () => {
  let app: INestApplication<App>;
  let tenantRepo: Repository<Tenant>;
  let suspendedTenant: Tenant;

  const mockBoss = {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
    createQueue: jest.fn().mockResolvedValue(undefined),
    schedule: jest.fn().mockResolvedValue(undefined),
    work: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PgBossService)
      .useValue({
        boss: mockBoss,
        initializeBoss: jest.fn().mockResolvedValue(mockBoss),
      })
      .overrideGuard(JwtGuard)
      .useClass(TenantAuthStubGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    tenantRepo = moduleFixture.get(getRepositoryToken(Tenant));
  });

  beforeEach(async () => {
    suspendedTenant = await tenantRepo.save(
      tenantRepo.create({
        name: 'Suspended Tenant',
        slug: `tenant-status-e2e-${Date.now()}`,
        config: {},
        status: TenantStatus.SUSPENDED,
      }),
    );
  });

  afterEach(async () => {
    await tenantRepo.delete(suspendedTenant.id);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it.each([
    ['GET', (id: string) => `${API_BASE_PATH}/tenants/${id}/audit-logs`],
    ['GET', (id: string) => `${API_BASE_PATH}/connections/tenant/${id}`],
    ['GET', (id: string) => `${API_BASE_PATH}/tenants/${id}/clients`],
    ['GET', (id: string) => `${API_BASE_PATH}/tenants/${id}/connectors`],
    [
      'GET',
      (id: string) => `${API_BASE_PATH}/credential-definitions/tenant/${id}`,
    ],
    [
      'GET',
      (id: string) =>
        `${API_BASE_PATH}/tenants/${id}/operations/123e4567-e89b-12d3-a456-426614174000`,
    ],
  ] as Array<[string, (id: string) => string]>)(
    '%s %s returns 403 TENANT_NOT_ACTIVE for a suspended tenant',
    async (method, buildPath) => {
      const response = await request(app.getHttpServer())
        [method.toLowerCase() as 'get'](buildPath(suspendedTenant.id))
        .expect(403);

      expect(response.body).toMatchObject({
        error: { code: 'TENANT_NOT_ACTIVE' },
      });
    },
  );
});
