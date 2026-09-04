import { JwtGuard, ScopeGuard } from '@app/auth';
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

// See admin-operations.e2e-spec.ts: the guards are overridden so these cases
// exercise the business logic rather than token validation. Unauthenticated
// behaviour is asserted in the second describe below, and the platform-admin
// role requirement is asserted in admin-sessions.controller.spec.ts.
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

describe('AdminSessionsController (e2e)', () => {
  let app: INestApplication<App>;
  let tenantRepo: Repository<Tenant>;
  let tenantUserRepo: Repository<TenantUser>;
  let oidcRepo: Repository<OidcModel>;
  let auditRepo: Repository<AuditLog>;

  const externalUserId = 'e2e-keycloak-sub-1';
  const otherExternalUserId = 'e2e-keycloak-sub-2';

  beforeAll(async () => {
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

  afterEach(async () => {
    await oidcRepo.query('DELETE FROM oidc_model');
    await auditRepo.query('DELETE FROM audit_log');
    await tenantUserRepo.query('DELETE FROM tenant_user');
    // tenant has RESTRICT FKs; clear dependents this suite may share a
    // database with before removing the tenants themselves.
    await tenantRepo.query('DELETE FROM operation');
    await tenantRepo.query('DELETE FROM tenant');
  });

  afterAll(async () => {
    await app.close();
  });

  async function createUser(externalUserId: string): Promise<TenantUser> {
    const tenant = await tenantRepo.save(
      tenantRepo.create({
        name: `Revoke Tenant ${externalUserId}`,
        slug: `revoke-${externalUserId}`,
        config: {},
      }),
    );

    return tenantUserRepo.save(
      tenantUserRepo.create({
        tenantId: tenant.id,
        externalUserId,
        email: `${externalUserId}@example.test`,
        role: TenantUserRole.ADMIN,
        status: TenantUserStatus.ACTIVE,
      }),
    );
  }

  async function seedSession(
    account: string,
    sessionId: string,
    grantId: string,
  ): Promise<void> {
    await oidcRepo.save(
      oidcRepo.create({
        modelName: 'Session',
        oidcId: sessionId,
        accountId: account,
        payload: { accountId: account },
      }),
    );
    await oidcRepo.save(
      oidcRepo.create({
        modelName: 'Grant',
        oidcId: grantId,
        accountId: account,
        payload: { accountId: account },
      }),
    );
    await oidcRepo.save(
      oidcRepo.create({
        modelName: 'RefreshToken',
        oidcId: `${grantId}-rt`,
        accountId: account,
        grantId,
        payload: { accountId: account, grantId },
      }),
    );
  }

  it('revokes every session, grant and token for the user', async () => {
    const user = await createUser(externalUserId);
    await seedSession(user.id, 'sess-1', 'grant-1');
    await seedSession(user.id, 'sess-2', 'grant-2');

    const response = await request(app.getHttpServer())
      .post(`${API_BASE_PATH}/admin/users/${user.id}/revoke-sessions`)
      .expect(201);

    expect(response.body).toEqual({
      tenant_user_id: user.id,
      account_id: user.id,
      revoked_record_count: 6,
    });
    expect(await oidcRepo.count()).toBe(0);
  });

  it('leaves other accounts untouched', async () => {
    const user = await createUser(externalUserId);
    const other = await createUser(otherExternalUserId);
    await seedSession(user.id, 'sess-1', 'grant-1');
    await seedSession(other.id, 'sess-9', 'grant-9');

    await request(app.getHttpServer())
      .post(`${API_BASE_PATH}/admin/users/${user.id}/revoke-sessions`)
      .expect(201);

    const remaining = await oidcRepo.find();
    expect(remaining).toHaveLength(3);
    expect(remaining.every((row) => row.accountId === other.id)).toBe(true);
  });

  it('writes a revoke audit entry scoped to the user tenant', async () => {
    const user = await createUser(externalUserId);
    await seedSession(user.id, 'sess-1', 'grant-1');

    await request(app.getHttpServer())
      .post(`${API_BASE_PATH}/admin/users/${user.id}/revoke-sessions`)
      .expect(201);

    const entries = await auditRepo.find();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      tenantId: user.tenantId,
      actorId: ADMIN_SUBJECT,
      actorType: 'user',
      action: 'revoke',
      resourceType: 'oidc_session',
      resourceId: user.id,
    });
  });

  it('is idempotent when the user has no sessions', async () => {
    const user = await createUser(externalUserId);

    const response = await request(app.getHttpServer())
      .post(`${API_BASE_PATH}/admin/users/${user.id}/revoke-sessions`)
      .expect(201);

    expect(response.body).toEqual({
      tenant_user_id: user.id,
      account_id: user.id,
      revoked_record_count: 0,
    });
  });

  it('returns 404 for an unknown user', async () => {
    await request(app.getHttpServer())
      .post(
        `${API_BASE_PATH}/admin/users/3f1d9c88-4b2e-4a6d-9f10-7c5b8e2a1d44/revoke-sessions`,
      )
      .expect(404);
  });

  it('returns 400 for a non-uuid user id', async () => {
    await request(app.getHttpServer())
      .post(`${API_BASE_PATH}/admin/users/not-a-uuid/revoke-sessions`)
      .expect(400);
  });
});

describe('AdminSessionsController (e2e) — unauthenticated', () => {
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
        stop: jest.fn().mockResolvedValue(undefined),
        isRunning: jest.fn().mockReturnValue(true),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a request with no bearer token', async () => {
    await request(app.getHttpServer())
      .post(
        `${API_BASE_PATH}/admin/users/3f1d9c88-4b2e-4a6d-9f10-7c5b8e2a1d44/revoke-sessions`,
      )
      .expect(401);
  });
});
