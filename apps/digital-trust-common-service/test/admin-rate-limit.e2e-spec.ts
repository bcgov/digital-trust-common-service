import { JwtGuard, ScopeGuard } from '@app/auth';
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
import { AuditLog } from '../src/audit-log/audit-log.entity';
import { API_BASE_PATH } from '../src/common/constants/api-version.constants';
import { RateLimitHit } from '../src/rate-limit/rate-limit-hit.entity';
import { Tenant } from '../src/tenant/tenant.entity';

// See admin-operations.e2e-spec.ts: the guards are overridden so these cases
// exercise the business logic rather than token validation. Unauthenticated
// behaviour is asserted in the second describe below, and the platform-admin
// role requirement is asserted in admin-rate-limit.controller.spec.ts.
const ADMIN_SUBJECT = 'e2e-admin-sub-1';

class AllowGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    // Stand in for JwtGuard so the audit actor is a real subject rather than
    // the unauthenticated 'system' fallback.
    context.switchToHttp().getRequest<{ auth?: { sub: string } }>().auth = {
      sub: ADMIN_SUBJECT,
    };

    return true;
  }
}

const mockBoss = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  send: jest.fn().mockResolvedValue(undefined),
  createQueue: jest.fn().mockResolvedValue(undefined),
  schedule: jest.fn().mockResolvedValue(undefined),
  work: jest.fn().mockResolvedValue(undefined),
};

describe('AdminRateLimitController (e2e)', () => {
  let app: INestApplication<App>;
  let tenantRepo: Repository<Tenant>;
  let hitRepo: Repository<RateLimitHit>;
  let auditRepo: Repository<AuditLog>;

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
      .useClass(AllowGuard)
      .overrideGuard(ScopeGuard)
      .useClass(AllowGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    tenantRepo = moduleFixture.get(getRepositoryToken(Tenant));
    hitRepo = moduleFixture.get(getRepositoryToken(RateLimitHit));
    auditRepo = moduleFixture.get(getRepositoryToken(AuditLog));
  });

  afterEach(async () => {
    await hitRepo.query('DELETE FROM rate_limit_hits');
    await auditRepo.query('DELETE FROM audit_log');
    // tenant has RESTRICT FKs; clear dependents this suite may share a
    // database with before removing the tenants themselves.
    await tenantRepo.query('DELETE FROM operation');
    await tenantRepo.query('DELETE FROM tenant');
  });

  afterAll(async () => {
    await app.close();
  });

  async function createTenant(
    config: Record<string, unknown> = {},
  ): Promise<Tenant> {
    return tenantRepo.save(
      tenantRepo.create({
        name: `Rate Limit Tenant ${Date.now()}-${Math.random()}`,
        slug: `rate-limit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        config,
      }),
    );
  }

  async function seedHit(
    tenantId: string,
    routeKey: string,
    hitAt?: Date,
  ): Promise<void> {
    const hit = await hitRepo.save(
      hitRepo.create({ tracker: tenantId, routeKey }),
    );

    if (hitAt) {
      await hitRepo.update(hit.id, { hitAt });
    }
  }

  describe('GET /admin/rate-limits/:tenantId', () => {
    it('returns the standard tier and limit by default', async () => {
      const tenant = await createTenant();

      const response = await request(app.getHttpServer())
        .get(`${API_BASE_PATH}/admin/rate-limits/${tenant.id}`)
        .expect(200);

      expect(response.body).toMatchObject({
        tenant_id: tenant.id,
        tier: 'standard',
        routes: [],
      });
    });

    it('returns the premium tier and limit when configured', async () => {
      const tenant = await createTenant({ rate_limits: { tier: 'premium' } });

      const response = await request(app.getHttpServer())
        .get(`${API_BASE_PATH}/admin/rate-limits/${tenant.id}`)
        .expect(200);

      expect(response.body).toMatchObject({
        tenant_id: tenant.id,
        tier: 'premium',
      });
      expect((response.body as { limit: number }).limit).toBeGreaterThan(0);
    });

    it('groups hit counts by route within the current window', async () => {
      const tenant = await createTenant();
      await seedHit(tenant.id, 'IssuanceController.issue');
      await seedHit(tenant.id, 'IssuanceController.issue');
      await seedHit(tenant.id, 'VerificationController.verify');

      const response = await request(app.getHttpServer())
        .get(`${API_BASE_PATH}/admin/rate-limits/${tenant.id}`)
        .expect(200);

      const body = response.body as {
        routes: { route_key: string; hits: number }[];
      };
      expect(body.routes).toEqual(
        expect.arrayContaining([
          { route_key: 'IssuanceController.issue', hits: 2 },
          { route_key: 'VerificationController.verify', hits: 1 },
        ]),
      );
    });

    it('excludes hits outside the current sliding window', async () => {
      const tenant = await createTenant();
      const staleDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await seedHit(tenant.id, 'IssuanceController.issue', staleDate);

      const response = await request(app.getHttpServer())
        .get(`${API_BASE_PATH}/admin/rate-limits/${tenant.id}`)
        .expect(200);

      expect((response.body as { routes: unknown[] }).routes).toEqual([]);
    });

    it('returns 404 for an unknown tenant', async () => {
      await request(app.getHttpServer())
        .get(
          `${API_BASE_PATH}/admin/rate-limits/3f1d9c88-4b2e-4a6d-9f10-7c5b8e2a1d44`,
        )
        .expect(404);
    });

    it('returns 400 for a non-uuid tenant id', async () => {
      await request(app.getHttpServer())
        .get(`${API_BASE_PATH}/admin/rate-limits/not-a-uuid`)
        .expect(400);
    });
  });

  describe('POST /admin/rate-limits/:tenantId/reset', () => {
    it('deletes every hit for the tenant and returns the count', async () => {
      const tenant = await createTenant();
      await seedHit(tenant.id, 'IssuanceController.issue');
      await seedHit(tenant.id, 'IssuanceController.issue');

      const response = await request(app.getHttpServer())
        .post(`${API_BASE_PATH}/admin/rate-limits/${tenant.id}/reset`)
        .expect(201);

      expect(response.body).toEqual({
        tenant_id: tenant.id,
        deleted_count: 2,
      });
      expect(await hitRepo.count()).toBe(0);
    });

    it('leaves other tenants untouched', async () => {
      const tenant = await createTenant();
      const other = await createTenant();
      await seedHit(tenant.id, 'IssuanceController.issue');
      await seedHit(other.id, 'IssuanceController.issue');

      await request(app.getHttpServer())
        .post(`${API_BASE_PATH}/admin/rate-limits/${tenant.id}/reset`)
        .expect(201);

      const remaining = await hitRepo.find();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].tracker).toBe(other.id);
    });

    it('writes a delete audit entry scoped to the tenant', async () => {
      const tenant = await createTenant();
      await seedHit(tenant.id, 'IssuanceController.issue');

      await request(app.getHttpServer())
        .post(`${API_BASE_PATH}/admin/rate-limits/${tenant.id}/reset`)
        .expect(201);

      const entries = await auditRepo.find();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        tenantId: tenant.id,
        actorId: ADMIN_SUBJECT,
        actorType: 'user',
        action: 'delete',
        resourceType: 'rate_limit_hit',
        resourceId: tenant.id,
      });
    });

    it('is idempotent when the tenant has no hits', async () => {
      const tenant = await createTenant();

      const response = await request(app.getHttpServer())
        .post(`${API_BASE_PATH}/admin/rate-limits/${tenant.id}/reset`)
        .expect(201);

      expect(response.body).toEqual({
        tenant_id: tenant.id,
        deleted_count: 0,
      });
    });

    it('returns 404 for an unknown tenant', async () => {
      await request(app.getHttpServer())
        .post(
          `${API_BASE_PATH}/admin/rate-limits/3f1d9c88-4b2e-4a6d-9f10-7c5b8e2a1d44/reset`,
        )
        .expect(404);
    });

    it('returns 400 for a non-uuid tenant id', async () => {
      await request(app.getHttpServer())
        .post(`${API_BASE_PATH}/admin/rate-limits/not-a-uuid/reset`)
        .expect(400);
    });
  });
});

describe('AdminRateLimitController (e2e) — unauthenticated', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    // No guard overrides: documents actual production behaviour. The real
    // JwtGuard rejects an unauthenticated request at the door, before
    // ScopeGuard gets to check the platform-admin role.
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
    await app.close();
  });

  it('rejects a status request with no bearer token', async () => {
    await request(app.getHttpServer())
      .get(
        `${API_BASE_PATH}/admin/rate-limits/3f1d9c88-4b2e-4a6d-9f10-7c5b8e2a1d44`,
      )
      .expect(401);
  });

  it('rejects a reset request with no bearer token', async () => {
    await request(app.getHttpServer())
      .post(
        `${API_BASE_PATH}/admin/rate-limits/3f1d9c88-4b2e-4a6d-9f10-7c5b8e2a1d44/reset`,
      )
      .expect(401);
  });
});
