import { JwtGuard, ScopeGuard, TENANT_SUPERUSER_SCOPE } from '@app/auth';
import { OidcModel } from '@app/oidc/entities/oidc-model.entity';
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
import { Tenant } from '../src/tenant/tenant.entity';
import {
  TenantUser,
  TenantUserRole,
  TenantUserStatus,
} from '../src/tenant-user/tenant-user.entity';

// As in admin-sessions.e2e-spec.ts, the guards are overridden so these cases
// exercise the business logic rather than token validation. Unauthenticated
// behaviour is asserted in the last describe; the scope requirement itself is
// a guard concern covered by ScopeGuard's own tests.
const ACTOR_SUBJECT = 'e2e-owner-sub-1';

interface RoleMapping {
  name: string;
  scopes: string[];
  source: string;
}

interface RoleMappingList {
  data: RoleMapping[];
}

interface ScopeCatalogList {
  data: Array<{ name: string; description: string; level: number }>;
}

interface RoleScopesBody {
  role: string;
  scopes: string[];
  source: string;
  revokedRecordCount: number;
}

interface ErrorBody {
  code?: string;
  role?: string;
}

/**
 * Stands in for JwtGuard so the audit actor is a real subject rather than the
 * unauthenticated fallback. TenantGuard is left in place and runs for real, so
 * the stub echoes the route tenant back as the token claim; the mismatch path
 * is asserted in the cross-tenant describe below.
 */
class AllowGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ auth?: unknown; params?: Record<string, string> }>();

    request.auth = {
      sub: ACTOR_SUBJECT,
      roles: [],
      scopes: [TENANT_SUPERUSER_SCOPE],
      tenantId: request.params?.tenantId ?? null,
    };

    return true;
  }
}

/** Same principal, but pinned to a tenant it is not being asked about. */
class ForeignTenantGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest<{ auth?: unknown }>().auth = {
      sub: ACTOR_SUBJECT,
      roles: [],
      scopes: [TENANT_SUPERUSER_SCOPE],
      tenantId: '11111111-2222-4333-8444-555555555555',
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

describe('Role scope API (e2e)', () => {
  let app: INestApplication<App>;
  let tenantRepo: Repository<Tenant>;
  let tenantUserRepo: Repository<TenantUser>;
  let oidcRepo: Repository<OidcModel>;
  let auditRepo: Repository<AuditLog>;
  let tenant: Tenant;

  const scopesPath = (tenantId: string, role: string): string =>
    `${API_BASE_PATH}/tenants/${tenantId}/roles/${role}/scopes`;

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
    tenantUserRepo = moduleFixture.get(getRepositoryToken(TenantUser));
    oidcRepo = moduleFixture.get(getRepositoryToken(OidcModel));
    auditRepo = moduleFixture.get(getRepositoryToken(AuditLog));
  });

  beforeEach(async () => {
    tenant = await tenantRepo.save(
      tenantRepo.create({
        name: 'Role Scope Tenant',
        slug: `role-scope-${Date.now()}`,
        config: {},
      }),
    );
  });

  afterEach(async () => {
    await oidcRepo.query('DELETE FROM oidc_model');
    await auditRepo.query('DELETE FROM audit_log');
    await tenantUserRepo.query('DELETE FROM tenant_user');
    await tenantRepo.query('DELETE FROM tenant_role_scope');
    await tenantRepo.query('DELETE FROM operation');
    await tenantRepo.query('DELETE FROM tenant');
  });

  afterAll(async () => {
    await app.close();
  });

  async function createUser(role: TenantUserRole): Promise<TenantUser> {
    return tenantUserRepo.save(
      tenantUserRepo.create({
        tenantId: tenant.id,
        externalUserId: `e2e-${role}-${Date.now()}`,
        email: `${role}-${Date.now()}@example.test`,
        role,
        status: TenantUserStatus.ACTIVE,
      }),
    );
  }

  async function seedSession(accountId: string, suffix: string): Promise<void> {
    await oidcRepo.save(
      oidcRepo.create({
        modelName: 'Session',
        oidcId: `sess-${suffix}`,
        accountId,
        payload: { accountId },
      }),
    );
    await oidcRepo.save(
      oidcRepo.create({
        modelName: 'Grant',
        oidcId: `grant-${suffix}`,
        accountId,
        payload: { accountId },
      }),
    );
    await oidcRepo.save(
      oidcRepo.create({
        modelName: 'RefreshToken',
        oidcId: `rt-${suffix}`,
        accountId,
        grantId: `grant-${suffix}`,
        payload: { accountId, grantId: `grant-${suffix}` },
      }),
    );
  }

  describe('catalog', () => {
    it('publishes the level 1 superuser scope', async () => {
      const response = await request(app.getHttpServer())
        .get(`${API_BASE_PATH}/scopes`)
        .expect(200);

      expect((response.body as ScopeCatalogList).data).toContainEqual(
        expect.objectContaining({ name: TENANT_SUPERUSER_SCOPE, level: 1 }),
      );
    });

    it('serves the seeded default role mapping', async () => {
      const response = await request(app.getHttpServer())
        .get(`${API_BASE_PATH}/roles`)
        .expect(200);

      const body = response.body as RoleMappingList;

      expect(body.data).toContainEqual({
        name: 'owner',
        scopes: [TENANT_SUPERUSER_SCOPE],
        source: 'default',
      });
      expect(body.data).toContainEqual({
        name: 'member',
        scopes: ['credentials:offer', 'credentials:verify'],
        source: 'default',
      });
    });
  });

  describe('overrides', () => {
    it('reports every role as default before any override', async () => {
      const response = await request(app.getHttpServer())
        .get(`${API_BASE_PATH}/tenants/${tenant.id}/roles`)
        .expect(200);

      expect(
        (response.body as RoleMappingList).data.every(
          (entry) => entry.source === 'default',
        ),
      ).toBe(true);
    });

    it('reflects a write on the tenant mapping as an override', async () => {
      await request(app.getHttpServer())
        .patch(scopesPath(tenant.id, 'member'))
        .send({ scopes: ['credentials:offer'] })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get(`${API_BASE_PATH}/tenants/${tenant.id}/roles`)
        .expect(200);

      expect((response.body as RoleMappingList).data).toContainEqual({
        name: 'member',
        scopes: ['credentials:offer'],
        source: 'override',
      });
    });

    it('is visible immediately, so no replica may cache the mapping', async () => {
      await request(app.getHttpServer())
        .patch(scopesPath(tenant.id, 'member'))
        .send({ scopes: ['credentials:offer'] })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get(`${API_BASE_PATH}/tenants/${tenant.id}/roles`)
        .expect(200);

      expect(
        (response.body as RoleMappingList).data.find(
          (entry) => entry.name === 'member',
        )?.scopes,
      ).toEqual(['credentials:offer']);
    });

    it('keeps an explicitly empty role distinct from an inherited one', async () => {
      await request(app.getHttpServer())
        .patch(scopesPath(tenant.id, 'member'))
        .send({ scopes: [] })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get(`${API_BASE_PATH}/tenants/${tenant.id}/roles`)
        .expect(200);

      const body = response.body as RoleMappingList;
      const member = body.data.find((entry) => entry.name === 'member');
      const readonly = body.data.find((entry) => entry.name === 'readonly');

      expect(member).toEqual({
        name: 'member',
        scopes: [],
        source: 'override',
      });
      expect(readonly?.source).toBe('default');
    });

    it('reverts to the default on delete', async () => {
      await request(app.getHttpServer())
        .patch(scopesPath(tenant.id, 'member'))
        .send({ scopes: ['credentials:offer'] })
        .expect(200);

      const response = await request(app.getHttpServer())
        .delete(scopesPath(tenant.id, 'member'))
        .expect(200);

      expect(response.body).toMatchObject({
        role: 'member',
        scopes: ['credentials:offer', 'credentials:verify'],
        source: 'default',
      });
    });

    it('treats delete as idempotent', async () => {
      await request(app.getHttpServer())
        .delete(scopesPath(tenant.id, 'member'))
        .expect(200);
      await request(app.getHttpServer())
        .delete(scopesPath(tenant.id, 'member'))
        .expect(200);
    });
  });

  describe('validation', () => {
    it('rejects an unknown scope', async () => {
      const response = await request(app.getHttpServer())
        .patch(scopesPath(tenant.id, 'member'))
        .send({ scopes: ['credentials:teleport'] })
        .expect(400);

      expect((response.body as ErrorBody).code).toBe('unknown_scope');
    });

    it('rejects an unknown role with 400 rather than a database error', async () => {
      await request(app.getHttpServer())
        .patch(scopesPath(tenant.id, 'superuser'))
        .send({ scopes: [] })
        .expect(400);
    });

    it('refuses to modify the owner role', async () => {
      const response = await request(app.getHttpServer())
        .patch(scopesPath(tenant.id, 'owner'))
        .send({ scopes: [] })
        .expect(400);

      expect((response.body as ErrorBody).code).toBe('role_immutable');
    });

    it('refuses to grant tenants:admin to another role', async () => {
      const response = await request(app.getHttpServer())
        .patch(scopesPath(tenant.id, 'admin'))
        .send({ scopes: [TENANT_SUPERUSER_SCOPE] })
        .expect(400);

      expect((response.body as ErrorBody).code).toBe('scope_not_assignable');
    });

    it('rejects a child holding a scope its parent lacks', async () => {
      // Narrowing admin to exactly member's defaults is legal; going narrower
      // would already fail here, because validation covers the whole mapping.
      await request(app.getHttpServer())
        .patch(scopesPath(tenant.id, 'admin'))
        .send({ scopes: ['credentials:offer', 'credentials:verify'] })
        .expect(200);

      const response = await request(app.getHttpServer())
        .patch(scopesPath(tenant.id, 'member'))
        .send({ scopes: ['credentials:offer', 'audit:read'] })
        .expect(400);

      expect(response.body).toMatchObject({
        code: 'hierarchy_violation',
        role: 'member',
      });
    });

    it('rejects narrowing a parent below its children', async () => {
      // member keeps its default credentials:verify, so admin cannot drop it.
      const response = await request(app.getHttpServer())
        .patch(scopesPath(tenant.id, 'admin'))
        .send({ scopes: ['credentials:offer'] })
        .expect(400);

      expect(response.body).toMatchObject({
        code: 'hierarchy_violation',
        role: 'member',
      });
    });

    it('leaves no write behind when validation fails', async () => {
      await request(app.getHttpServer())
        .patch(scopesPath(tenant.id, 'member'))
        .send({ scopes: ['nope'] })
        .expect(400);

      const response = await request(app.getHttpServer())
        .get(`${API_BASE_PATH}/tenants/${tenant.id}/roles`)
        .expect(200);

      expect(
        (response.body as RoleMappingList).data.find(
          (entry) => entry.name === 'member',
        )?.source,
      ).toBe('default');
      expect(await auditRepo.count()).toBe(0);
    });
  });

  describe('session revocation', () => {
    it('revokes sessions for the role when scopes are removed', async () => {
      const member = await createUser(TenantUserRole.MEMBER);
      await seedSession(member.id, 'member');

      const response = await request(app.getHttpServer())
        .patch(scopesPath(tenant.id, 'member'))
        .send({ scopes: ['credentials:offer'] })
        .expect(200);

      expect((response.body as RoleScopesBody).revokedRecordCount).toBe(3);
      expect(await oidcRepo.count()).toBe(0);
    });

    it('leaves other roles signed in', async () => {
      const member = await createUser(TenantUserRole.MEMBER);
      const admin = await createUser(TenantUserRole.ADMIN);
      await seedSession(member.id, 'member');
      await seedSession(admin.id, 'admin');

      await request(app.getHttpServer())
        .patch(scopesPath(tenant.id, 'member'))
        .send({ scopes: [] })
        .expect(200);

      const remaining = await oidcRepo.find();
      expect(remaining).toHaveLength(3);
      expect(remaining.every((row) => row.accountId === admin.id)).toBe(true);
    });

    it('does not revoke when the change only widens the role', async () => {
      const member = await createUser(TenantUserRole.MEMBER);
      await seedSession(member.id, 'member');

      const response = await request(app.getHttpServer())
        .patch(scopesPath(tenant.id, 'member'))
        .send({
          scopes: [
            'credentials:offer',
            'credentials:verify',
            'connections:manage',
          ],
        })
        .expect(200);

      expect((response.body as RoleScopesBody).revokedRecordCount).toBe(0);
      expect(await oidcRepo.count()).toBe(3);
    });

    it('writes one audit entry for the role, not one per user', async () => {
      await createUser(TenantUserRole.MEMBER);
      await createUser(TenantUserRole.MEMBER);

      await request(app.getHttpServer())
        .patch(scopesPath(tenant.id, 'member'))
        .send({ scopes: [] })
        .expect(200);

      const entries = await auditRepo.find();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        tenantId: tenant.id,
        actorId: ACTOR_SUBJECT,
        actorType: 'user',
        action: 'update',
        resourceType: 'tenant_role_scope',
        resourceId: tenant.id,
      });
      expect(entries[0].metadata).toMatchObject({ role: 'member' });
    });
  });
});

describe('Role scope API (e2e) — unauthenticated', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    // No guard overrides: the real JwtGuard rejects at the door, including on
    // the catalog routes, which are authenticated despite being non-secret.
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

  it('rejects the scope catalog without a token', async () => {
    await request(app.getHttpServer())
      .get(`${API_BASE_PATH}/scopes`)
      .expect(401);
  });

  it('rejects the role catalog without a token', async () => {
    await request(app.getHttpServer())
      .get(`${API_BASE_PATH}/roles`)
      .expect(401);
  });

  it('rejects an override write without a token', async () => {
    await request(app.getHttpServer())
      .patch(
        `${API_BASE_PATH}/tenants/3f1d9c88-4b2e-4a6d-9f10-7c5b8e2a1d44/roles/member/scopes`,
      )
      .send({ scopes: [] })
      .expect(401);
  });
});

describe('Role scope API (e2e) — cross-tenant', () => {
  let app: INestApplication<App>;

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
      .useClass(ForeignTenantGuard)
      .overrideGuard(ScopeGuard)
      .useClass(ForeignTenantGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("refuses to read another tenant's mapping", async () => {
    await request(app.getHttpServer())
      .get(
        `${API_BASE_PATH}/tenants/3f1d9c88-4b2e-4a6d-9f10-7c5b8e2a1d44/roles`,
      )
      .expect(403);
  });

  it("refuses to write another tenant's mapping", async () => {
    await request(app.getHttpServer())
      .patch(
        `${API_BASE_PATH}/tenants/3f1d9c88-4b2e-4a6d-9f10-7c5b8e2a1d44/roles/member/scopes`,
      )
      .send({ scopes: [] })
      .expect(403);
  });
});
