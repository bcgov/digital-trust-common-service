import {
  ScopeAuthorizationService,
  ALL_TENANT_SCOPES,
  SCOPE_CATALOG,
  TENANT_SUPERUSER_SCOPE,
} from '@app/auth';
import { OidcAccountSessionRepository } from '@app/oidc/sessions';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';

import { AuditAction, AuditActorType } from '../audit-log/audit-log.entity';
import { AuditLogService } from '../audit-log/audit-log.service';

import { RoleScopeRepository } from './role-scope.repository';
import { RoleScopeService } from './role-scope.service';

const TENANT_ID = '2c9f6c6a-2f1d-4c1a-9b8f-6d5b6d0f7a11';
const ACTOR_ID = '4d1e2f3a-5b6c-4d7e-8f90-a1b2c3d4e5f6';

/** Mirrors the mapping seeded by migration 000013. */
const SEEDED_DEFAULTS: Record<string, string[]> = {
  owner: [TENANT_SUPERUSER_SCOPE],
  admin: [...ALL_TENANT_SCOPES],
  member: ['credentials:offer', 'credentials:verify'],
  readonly: [],
};

describe('RoleScopeService', () => {
  let service: RoleScopeService;
  let repository: jest.Mocked<Partial<RoleScopeRepository>>;
  let accountSessions: { deleteAllForTenantRole: jest.Mock };
  let auditLog: { write: jest.Mock };
  let overrides: Array<{ role: string; scopes: string[] }>;
  let manager: EntityManager;

  /** Superuser actor, matching the `tenants:admin` the endpoint requires. */
  const superuserActor = {
    actorId: ACTOR_ID,
    actorScopes: [TENANT_SUPERUSER_SCOPE],
    actorRoles: ['admin'],
    actorTokenType: 'user' as const,
  };

  beforeEach(async () => {
    overrides = [];
    manager = {} as EntityManager;

    repository = {
      findDefaultRoleScopes: jest
        .fn()
        .mockImplementation(() => Promise.resolve({ ...SEEDED_DEFAULTS })),
      findTenantOverrides: jest
        .fn()
        .mockImplementation(() => Promise.resolve(overrides)),
      upsertTenantRoleScopes: jest
        .fn()
        .mockImplementation((_tenantId, role: string, scopes) => {
          overrides = [
            ...overrides.filter((entry) => entry.role !== role),
            { role, scopes },
          ];

          return Promise.resolve();
        }),
      deleteTenantRoleScopes: jest
        .fn()
        .mockImplementation((_tenantId, role: string) => {
          const before = overrides.length;
          overrides = overrides.filter((entry) => entry.role !== role);

          return Promise.resolve(overrides.length < before);
        }),
      lockTenantForRoleScopeWrite: jest.fn().mockResolvedValue(undefined),
    };

    accountSessions = {
      deleteAllForTenantRole: jest
        .fn()
        .mockResolvedValue([{ modelName: 'Grant', count: 3 }]),
    };
    auditLog = { write: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoleScopeService,
        ScopeAuthorizationService,
        { provide: RoleScopeRepository, useValue: repository },
        { provide: OidcAccountSessionRepository, useValue: accountSessions },
        { provide: AuditLogService, useValue: auditLog },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn(
              async (callback: (m: EntityManager) => Promise<unknown>) =>
                callback(manager),
            ),
          },
        },
      ],
    }).compile();

    service = module.get(RoleScopeService);
  });

  describe('catalog', () => {
    it('includes the level 1 superuser scope', () => {
      // tenants:admin is not in ALL_TENANT_SCOPES, so a catalog derived from
      // that constant would silently omit the most privileged scope.
      expect(
        service
          .getScopeCatalog()
          .find((e) => e.name === TENANT_SUPERUSER_SCOPE),
      ).toEqual(
        expect.objectContaining({ name: TENANT_SUPERUSER_SCOPE, level: 1 }),
      );
    });

    it('covers every assignable tenant scope', () => {
      const names = new Set(SCOPE_CATALOG.map((entry) => entry.name));

      for (const scope of ALL_TENANT_SCOPES) {
        expect(names.has(scope)).toBe(true);
      }
    });
  });

  describe('resolution', () => {
    it('reports roles as default until the tenant overrides them', async () => {
      const mapping = await service.getTenantRoleMapping(TENANT_ID);

      expect(mapping.every((entry) => entry.source === 'default')).toBe(true);
    });

    it('treats an absent row as inherit and an empty array as no scopes', async () => {
      overrides = [{ role: 'member', scopes: [] }];

      const mapping = await service.getTenantRoleMapping(TENANT_ID);
      const member = mapping.find((entry) => entry.name === 'member');
      const readonly = mapping.find((entry) => entry.name === 'readonly');

      expect(member).toEqual({
        name: 'member',
        scopes: [],
        source: 'override',
      });
      expect(readonly?.source).toBe('default');
    });
  });

  describe('validation', () => {
    it('accepts the seeded defaults', async () => {
      // Raw-set admin ⊆ owner is false: owner holds only tenants:admin.
      // Validation must run on expanded scopes, and this is the test that
      // fails if someone "simplifies" the expansion away.
      await expect(
        service.replaceRoleScopes({
          tenantId: TENANT_ID,
          role: 'member',
          scopes: SEEDED_DEFAULTS.member,
          ...superuserActor,
        }),
      ).resolves.toEqual(expect.objectContaining({ role: 'member' }));
    });

    it('rejects an unknown scope name', async () => {
      await expect(
        service.replaceRoleScopes({
          tenantId: TENANT_ID,
          role: 'member',
          scopes: ['credentials:teleport'],
          ...superuserActor,
        }),
      ).rejects.toMatchObject({
        response: { code: 'unknown_scope' },
      });
    });

    it('refuses to modify the owner role', async () => {
      await expect(
        service.replaceRoleScopes({
          tenantId: TENANT_ID,
          role: 'owner',
          scopes: [],
          ...superuserActor,
        }),
      ).rejects.toMatchObject({ response: { code: 'role_immutable' } });
    });

    it('refuses to reset the owner role', async () => {
      await expect(
        service.resetRoleScopes({
          tenantId: TENANT_ID,
          role: 'owner',
          ...superuserActor,
        }),
      ).rejects.toMatchObject({ response: { code: 'role_immutable' } });
    });

    it('refuses to assign tenants:admin to a non-owner role', async () => {
      // Otherwise expandEffectiveScopes silently promotes every member to
      // superuser.
      await expect(
        service.replaceRoleScopes({
          tenantId: TENANT_ID,
          role: 'member',
          scopes: [TENANT_SUPERUSER_SCOPE],
          ...superuserActor,
        }),
      ).rejects.toMatchObject({ response: { code: 'scope_not_assignable' } });
    });

    it('rejects a child holding a scope its parent lacks', async () => {
      overrides = [{ role: 'admin', scopes: ['credentials:offer'] }];

      await expect(
        service.replaceRoleScopes({
          tenantId: TENANT_ID,
          role: 'member',
          scopes: ['credentials:offer', 'audit:read'],
          ...superuserActor,
        }),
      ).rejects.toMatchObject({
        response: { code: 'hierarchy_violation', role: 'member' },
      });
    });

    it('blocks an actor from granting a scope it does not hold', async () => {
      // A no-op while the route requires tenants:admin, which expands to
      // everything, so the actor scopes here are synthetic on purpose —
      // asserting it with a superuser actor would prove nothing.
      await expect(
        service.replaceRoleScopes({
          tenantId: TENANT_ID,
          role: 'member',
          scopes: ['audit:read'],
          actorId: ACTOR_ID,
          actorScopes: ['credentials:offer'],
          actorRoles: ['member'],
          actorTokenType: 'user' as const,
        }),
      ).rejects.toMatchObject({ response: { code: 'scope_escalation' } });
    });

    it('exempts a platform admin, whose token carries no tenant scopes', async () => {
      // ScopeGuard admits platform admins on role alone, so their scopes are
      // legitimately empty. Applying the escalation check to them would fail
      // every non-empty PATCH from a principal the guards trust above the
      // tenant.
      const result = await service.replaceRoleScopes({
        tenantId: TENANT_ID,
        role: 'member',
        scopes: ['audit:read'],
        actorId: ACTOR_ID,
        actorScopes: [],
        actorRoles: ['platform-admin'],
        actorTokenType: 'user' as const,
      });

      expect(result.scopes).toEqual(['audit:read']);
    });

    it('rejects rather than pruning, leaving no write behind', async () => {
      await expect(
        service.replaceRoleScopes({
          tenantId: TENANT_ID,
          role: 'member',
          scopes: ['nope'],
          ...superuserActor,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(repository.upsertTenantRoleScopes).not.toHaveBeenCalled();
      expect(auditLog.write).not.toHaveBeenCalled();
    });
  });

  describe('writes', () => {
    it('locks the tenant before reading the mapping it validates', async () => {
      const callOrder: string[] = [];

      (repository.lockTenantForRoleScopeWrite as jest.Mock).mockImplementation(
        () => {
          callOrder.push('lock');

          return Promise.resolve();
        },
      );
      (repository.findTenantOverrides as jest.Mock).mockImplementation(() => {
        callOrder.push('read');

        return Promise.resolve(overrides);
      });

      await service.replaceRoleScopes({
        tenantId: TENANT_ID,
        role: 'member',
        scopes: ['credentials:offer'],
        ...superuserActor,
      });

      // Validating against a snapshot taken before the lock is the same race
      // the lock exists to close.
      expect(callOrder[0]).toBe('lock');
    });

    it('does not revoke sessions when the change only widens the role', async () => {
      overrides = [{ role: 'member', scopes: ['credentials:offer'] }];

      const result = await service.replaceRoleScopes({
        tenantId: TENANT_ID,
        role: 'member',
        scopes: ['credentials:offer', 'credentials:verify'],
        ...superuserActor,
      });

      expect(accountSessions.deleteAllForTenantRole).not.toHaveBeenCalled();
      expect(result.revokedRecordCount).toBe(0);
    });

    it('revokes sessions when the change removes a scope', async () => {
      overrides = [
        { role: 'member', scopes: ['credentials:offer', 'credentials:verify'] },
      ];

      const result = await service.replaceRoleScopes({
        tenantId: TENANT_ID,
        role: 'member',
        scopes: ['credentials:offer'],
        ...superuserActor,
      });

      expect(accountSessions.deleteAllForTenantRole).toHaveBeenCalledWith(
        TENANT_ID,
        'member',
        manager,
      );
      expect(result.revokedRecordCount).toBe(3);
    });

    it('revokes once for the role rather than per user', async () => {
      overrides = [{ role: 'member', scopes: ['credentials:offer'] }];

      await service.replaceRoleScopes({
        tenantId: TENANT_ID,
        role: 'member',
        scopes: [],
        ...superuserActor,
      });

      expect(accountSessions.deleteAllForTenantRole).toHaveBeenCalledTimes(1);
      expect(auditLog.write).toHaveBeenCalledTimes(1);
    });

    it('writes the override, revocation, and audit entry in one transaction', async () => {
      overrides = [{ role: 'member', scopes: ['credentials:offer'] }];

      await service.replaceRoleScopes({
        tenantId: TENANT_ID,
        role: 'member',
        scopes: [],
        ...superuserActor,
      });

      expect(repository.upsertTenantRoleScopes).toHaveBeenCalledWith(
        TENANT_ID,
        'member',
        [],
        manager,
      );
      expect(auditLog.write).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          actorId: ACTOR_ID,
          actorType: AuditActorType.USER,
          action: AuditAction.UPDATE,
          resourceType: 'tenant_role_scope',
          resourceId: TENANT_ID,
          metadata: expect.objectContaining({
            role: 'member',
            removedScopes: ['credentials:offer'],
            revokedRecordCount: 3,
          }),
        }),
        manager,
      );
    });

    it('audits a reset as a delete, not an update', async () => {
      // The shared write path must not flatten DELETE into UPDATE, or audit
      // consumers cannot tell an override replacement from its removal.
      overrides = [{ role: 'member', scopes: ['audit:read'] }];

      await service.resetRoleScopes({
        tenantId: TENANT_ID,
        role: 'member',
        ...superuserActor,
      });

      expect(auditLog.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.DELETE }),
        manager,
      );
    });

    it('attributes a client_credentials caller as a client', async () => {
      await service.replaceRoleScopes({
        tenantId: TENANT_ID,
        role: 'member',
        scopes: ['credentials:offer'],
        ...superuserActor,
        actorTokenType: 'client' as const,
      });

      expect(auditLog.write).toHaveBeenCalledWith(
        expect.objectContaining({ actorType: AuditActorType.CLIENT }),
        manager,
      );
    });

    it('normalizes the submitted scope list', async () => {
      const result = await service.replaceRoleScopes({
        tenantId: TENANT_ID,
        role: 'member',
        scopes: [
          'credentials:verify',
          'credentials:offer',
          'credentials:offer',
        ],
        ...superuserActor,
      });

      expect(result.scopes).toEqual([
        'credentials:offer',
        'credentials:verify',
      ]);
    });

    it('reverts to the default on reset and reports the source', async () => {
      overrides = [{ role: 'member', scopes: ['credentials:offer'] }];

      const result = await service.resetRoleScopes({
        tenantId: TENANT_ID,
        role: 'member',
        ...superuserActor,
      });

      expect(result).toEqual(
        expect.objectContaining({
          role: 'member',
          scopes: SEEDED_DEFAULTS.member,
          source: 'default',
        }),
      );
    });

    it('is idempotent when there is no override to reset', async () => {
      await expect(
        service.resetRoleScopes({
          tenantId: TENANT_ID,
          role: 'member',
          ...superuserActor,
        }),
      ).resolves.toEqual(
        expect.objectContaining({ scopes: SEEDED_DEFAULTS.member }),
      );
    });

    it('revokes sessions when a reset narrows the role', async () => {
      overrides = [{ role: 'member', scopes: [...ALL_TENANT_SCOPES] }];
      // The override is wider than the seeded default, so resetting removes
      // scopes and must log the role's users out.
      const result = await service.resetRoleScopes({
        tenantId: TENANT_ID,
        role: 'member',
        ...superuserActor,
      });

      expect(result.revokedRecordCount).toBe(3);
    });
  });
});
