import {
  isKnownScope,
  ROLE_HIERARCHY,
  ScopeAuthorizationService,
  ScopeCatalogEntry,
  SCOPE_CATALOG,
  TENANT_SUPERUSER_SCOPE,
  TenantRole,
} from '@app/auth';
import type { AuthTokenType } from '@app/auth';
import { OidcAccountSessionRepository } from '@app/oidc/sessions';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { AuditAction, AuditActorType } from '../audit-log/audit-log.entity';
import { AuditLogService } from '../audit-log/audit-log.service';

import { RoleScopeRepository } from './role-scope.repository';

/** The role whose scopes a tenant may never change. */
const IMMUTABLE_ROLE: TenantRole = 'owner';

/** Where a role's effective scopes came from. */
export type RoleScopeSource = 'default' | 'override';

export interface RoleScopeMappingEntry {
  name: string;
  scopes: string[];
  source: RoleScopeSource;
}

export interface RoleScopeWriteRequest {
  tenantId: string;
  role: string;
  actorId: string;
  actorScopes: readonly string[];
  actorRoles: readonly string[];
  /** Distinguishes a human caller from a `client_credentials` one in audit. */
  actorTokenType: AuthTokenType;
}

export interface RoleScopeWriteResult {
  role: string;
  scopes: string[];
  source: RoleScopeSource;
  revokedRecordCount: number;
}

/**
 * Role → scope resolution and per-tenant overrides (AU-07 #40).
 *
 * Overrides are authoritative per role: an absent row inherits the global
 * default, a present row replaces it outright, and a present row holding an
 * empty array means the role has no scopes at all. `readonly` ships with no
 * scopes, so "empty" and "inherit" are genuinely different states and must
 * not be collapsed.
 */
@Injectable()
export class RoleScopeService {
  private readonly logger = new Logger(RoleScopeService.name);

  public constructor(
    private readonly repository: RoleScopeRepository,
    private readonly scopeAuthorization: ScopeAuthorizationService,
    private readonly accountSessions: OidcAccountSessionRepository,
    private readonly auditLog: AuditLogService,
    private readonly dataSource: DataSource,
  ) {}

  /** Static catalog backing `GET /api/v1/scopes`. */
  public getScopeCatalog(): readonly ScopeCatalogEntry[] {
    return SCOPE_CATALOG;
  }

  /** Global defaults backing `GET /api/v1/roles`. */
  public async getDefaultRoleMapping(): Promise<RoleScopeMappingEntry[]> {
    const defaults = await this.repository.findDefaultRoleScopes();

    return ROLE_HIERARCHY.map((role) => ({
      name: role,
      scopes: defaults[role] ?? [],
      source: 'default' as const,
    }));
  }

  /**
   * A tenant's effective mapping, marking which roles it has customised so a
   * UI can offer "reset to default".
   */
  public async getTenantRoleMapping(
    tenantId: string,
    manager?: EntityManager,
  ): Promise<RoleScopeMappingEntry[]> {
    const [defaults, overrides] = await Promise.all([
      this.repository.findDefaultRoleScopes(manager),
      this.repository.findTenantOverrides(tenantId, manager),
    ]);
    const overrideByRole = new Map(
      overrides.map((entry) => [entry.role, entry.scopes]),
    );

    return ROLE_HIERARCHY.map((role) => {
      const override = overrideByRole.get(role);

      return {
        name: role,
        scopes: override ?? defaults[role] ?? [],
        source: override ? ('override' as const) : ('default' as const),
      };
    });
  }

  /** Replaces a tenant's scopes for one role. */
  public async replaceRoleScopes(
    request: RoleScopeWriteRequest & { scopes: string[] },
  ): Promise<RoleScopeWriteResult> {
    const scopes = [...new Set(request.scopes)].sort();

    this.assertScopesAssignable(request.role, scopes);

    return this.writeMapping(
      request,
      'override',
      AuditAction.UPDATE,
      async (manager) => {
        await this.repository.upsertTenantRoleScopes(
          request.tenantId,
          request.role,
          scopes,
          manager,
        );

        return scopes;
      },
    );
  }

  /** Drops a tenant's override so the role reverts to the global default. */
  public async resetRoleScopes(
    request: RoleScopeWriteRequest,
  ): Promise<RoleScopeWriteResult> {
    this.assertRoleMutable(request.role);

    return this.writeMapping(
      request,
      'default',
      AuditAction.DELETE,
      async (manager) => {
        await this.repository.deleteTenantRoleScopes(
          request.tenantId,
          request.role,
          manager,
        );
        const defaults = await this.repository.findDefaultRoleScopes(manager);

        return defaults[request.role] ?? [];
      },
    );
  }

  /**
   * Runs a mapping write under the tenant's advisory lock, validating the
   * whole resolved mapping and revoking sessions when the change narrows.
   *
   * Read, validate, write and revoke all share one transaction. The read must
   * be inside the lock, not just the write: validating against a snapshot
   * taken before the lock is the same race the lock exists to prevent.
   */
  private async writeMapping(
    request: RoleScopeWriteRequest,
    source: RoleScopeSource,
    action: AuditAction,
    apply: (manager: EntityManager) => Promise<string[]>,
  ): Promise<RoleScopeWriteResult> {
    const { tenantId, role, actorId, actorTokenType } = request;
    let narrowed = false;

    const result = await this.dataSource.transaction(async (manager) => {
      await this.repository.lockTenantForRoleScopeWrite(tenantId, manager);

      const before = await this.getTenantRoleMapping(tenantId, manager);
      const previousEntry = before.find((entry) => entry.name === role);
      const previous = previousEntry?.scopes ?? [];

      const scopes = await apply(manager);
      const after = await this.getTenantRoleMapping(tenantId, manager);

      this.assertNoEscalation(scopes, request);
      this.assertHierarchy(after);

      const removed = this.removedScopes(previous, scopes);

      narrowed = removed.length > 0;

      const revokedRecordCount = narrowed
        ? await this.revokeAffectedSessions(tenantId, role, manager)
        : 0;

      // An identical PATCH or a reset with no override row changes nothing.
      // Comparing the source as well as the scopes matters: pinning a role to
      // scopes equal to the current default still flips it from inherit to
      // override, which is a real change even though the scope list matches.
      const changed =
        (previousEntry?.source ?? 'default') !== source ||
        previous.join(' ') !== scopes.join(' ');

      if (!changed) {
        return { role, scopes, source, revokedRecordCount };
      }

      await this.auditLog.write(
        {
          tenantId,
          actorId,
          actorType:
            actorTokenType === 'client'
              ? AuditActorType.CLIENT
              : AuditActorType.USER,
          action,
          resourceType: 'tenant_role_scope',
          // audit_log.resource_id is a UUID column, and a role name is not a
          // UUID. The resource being changed is this tenant's mapping, so the
          // tenant is the identified resource and the role is metadata.
          resourceId: tenantId,
          metadata: {
            role,
            source,
            previousScopes: previous,
            scopes,
            removedScopes: removed,
            revokedRecordCount,
          },
        },
        manager,
      );

      if (removed.length > 0) {
        this.logger.log(
          `Narrowed role ${role} in tenant ${tenantId}; revoked ${revokedRecordCount} OIDC record(s)`,
        );
      }

      return { role, scopes, source, revokedRecordCount };
    });

    if (!narrowed) {
      return result;
    }

    // The in-transaction delete only sees grants that exist when it runs. A
    // login that read the old, wider mapping can save its grant between that
    // delete and COMMIT, so sweep once more now that the new mapping is
    // visible to every replica.
    //
    // This shrinks the window rather than closing it: a login that read the
    // old mapping before COMMIT can still save after this sweep. Closing it
    // fully means holding a shared lock across the grant write, which is not
    // reachable today because oidc-provider saves grants through its own
    // adapter connection rather than an EntityManager we can enlist (#193).
    const late = await this.revokeAffectedSessions(tenantId, role);

    if (late === 0) {
      return result;
    }

    this.logger.warn(
      `Revoked ${late} OIDC record(s) for role ${role} in tenant ${tenantId} created during the override commit window`,
    );

    await this.auditLog.write({
      tenantId,
      actorId,
      actorType:
        actorTokenType === 'client'
          ? AuditActorType.CLIENT
          : AuditActorType.USER,
      action: AuditAction.REVOKE,
      resourceType: 'tenant_role_scope',
      resourceId: tenantId,
      metadata: {
        role,
        reason: 'commit_window_sweep',
        revokedRecordCount: late,
      },
    });

    return {
      ...result,
      revokedRecordCount: result.revokedRecordCount + late,
    };
  }

  /**
   * Narrowing a role must take effect now, not at the next login.
   *
   * The `scope` claim is fixed by the oidc-provider Grant created at login,
   * and the Grant is not re-saved when a refresh token rotates, so a removed
   * scope would otherwise stay live for the whole refresh chain — days, in
   * practice. Widening needs no action: the next login picks it up.
   */
  private async revokeAffectedSessions(
    tenantId: string,
    role: string,
    manager?: EntityManager,
  ): Promise<number> {
    const deleted = await this.accountSessions.deleteAllForTenantRole(
      tenantId,
      role,
      manager,
    );

    return deleted.reduce((total, entry) => total + entry.count, 0);
  }

  private removedScopes(previous: string[], next: string[]): string[] {
    const nextEffective = this.scopeAuthorization.expandEffectiveScopes(next);

    return [...this.scopeAuthorization.expandEffectiveScopes(previous)]
      .filter((scope) => !nextEffective.has(scope))
      .sort();
  }

  private assertScopesAssignable(role: string, scopes: string[]): void {
    this.assertRoleMutable(role);

    const unknown = scopes.filter((scope) => !isKnownScope(scope));

    if (unknown.length > 0) {
      throw new BadRequestException({
        code: 'unknown_scope',
        message: `Unknown scope(s): ${unknown.join(', ')}`,
      });
    }

    // Granting the superuser scope to a lesser role silently promotes every
    // one of its users, because expandEffectiveScopes turns it into all
    // scopes. It stays exclusive to `owner`.
    if (scopes.includes(TENANT_SUPERUSER_SCOPE)) {
      throw new BadRequestException({
        code: 'scope_not_assignable',
        message: `${TENANT_SUPERUSER_SCOPE} cannot be assigned to a role other than ${IMMUTABLE_ROLE}`,
      });
    }
  }

  /**
   * Rejects a write whose *resulting* scopes exceed what the actor holds.
   *
   * Runs on the post-state, not the request body, so it covers reset as well
   * as replace. The platform default can be wider than the override it
   * replaces, so validating only submitted scopes would leave DELETE as an
   * escalation path: a principal that cannot PATCH a role up to the default
   * could simply reset it there instead.
   *
   * A no-op while the route requires tenants:admin, which expands to every
   * scope. It is the invariant that keeps this safe if TM-02 delegates role
   * management to a lesser principal.
   */
  private assertNoEscalation(
    scopes: string[],
    actor: Pick<RoleScopeWriteRequest, 'actorScopes' | 'actorRoles'>,
  ): void {
    // Platform admins are exempt: ScopeGuard admits them on role alone, so
    // their token legitimately carries no tenant scopes. Applying the check to
    // them would reject every non-empty write from a principal the guards
    // already trust above the tenant.
    if (this.scopeAuthorization.isPlatformAdmin([...actor.actorRoles])) {
      return;
    }

    const actorEffective = this.scopeAuthorization.expandEffectiveScopes(
      actor.actorScopes,
    );
    const escalated = scopes.filter((scope) => !actorEffective.has(scope));

    if (escalated.length > 0) {
      throw new BadRequestException({
        code: 'scope_escalation',
        message: `Cannot grant scope(s) you do not hold: ${escalated.join(', ')}`,
      });
    }
  }

  private assertRoleMutable(role: string): void {
    // `owner` is the hierarchy root and the tenant's recovery path. A tenant
    // that can strip its own owner can lock itself out and needs a platform
    // admin to get back in.
    if (role === IMMUTABLE_ROLE) {
      throw new BadRequestException({
        code: 'role_immutable',
        message: `The ${IMMUTABLE_ROLE} role cannot be modified`,
      });
    }
  }

  /**
   * Every role must be a subset of the one above it.
   *
   * Compared on *expanded* scopes: `owner` holds only `tenants:admin`, so a
   * raw set comparison reports the seeded defaults as invalid.
   *
   * Checked across the whole mapping rather than just the edited role —
   * narrowing `admin` alone would otherwise leave `member` holding scopes its
   * parent lacks. Violations are rejected rather than cascade-pruned: one
   * call quietly revoking privileges from roles the caller never named is a
   * surprising side effect, and the audit entry would not reflect intent.
   */
  private assertHierarchy(mapping: RoleScopeMappingEntry[]): void {
    const byRole = new Map(mapping.map((entry) => [entry.name, entry.scopes]));

    for (let index = 1; index < ROLE_HIERARCHY.length; index += 1) {
      const parent = ROLE_HIERARCHY[index - 1];
      const child = ROLE_HIERARCHY[index];
      const parentScopes = this.scopeAuthorization.expandEffectiveScopes(
        byRole.get(parent) ?? [],
      );
      const childScopes = byRole.get(child) ?? [];
      const excess = [
        ...this.scopeAuthorization.expandEffectiveScopes(childScopes),
      ]
        .filter((scope) => !parentScopes.has(scope))
        .sort();

      if (excess.length > 0) {
        throw new BadRequestException({
          code: 'hierarchy_violation',
          message: `Role ${child} would hold scope(s) that ${parent} lacks: ${excess.join(', ')}`,
          role: child,
          scopes: excess,
        });
      }
    }
  }
}
