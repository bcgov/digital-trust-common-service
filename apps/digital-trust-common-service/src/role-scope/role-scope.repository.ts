import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

/** Fixed advisory-lock class id for tenant role-scope writes. */
export const ROLE_SCOPE_LOCK_CLASS = 4207;

/** A tenant's stored override for one role. */
export interface TenantRoleScopeOverride {
  role: string;
  scopes: string[];
}

/**
 * Resolves tenant-user role → scope mappings from the `role_scope` table,
 * and per-tenant overrides from `tenant_role_scope` (AU-07 #40).
 *
 * Provided by `RoleScopeModule` for AU-02 (#35) user-token issuance.
 * AU-04 seeds the default table and implements ScopeGuard enforcement only;
 * client_credentials scopes still come from `oauth_client.scopes` and are
 * deliberately unaffected by tenant role overrides.
 */
@Injectable()
export class RoleScopeRepository {
  public constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Effective scopes for a role, preferring the tenant's override when one
   * exists and falling back to the global default otherwise.
   *
   * `tenantId` is optional so that existing callers keep compiling; omitting
   * it returns the global defaults.
   */
  public async findScopesForRole(
    role: string,
    tenantId?: string,
    manager?: EntityManager,
  ): Promise<string[]> {
    if (!tenantId) {
      const rows = await this.runner(manager).query<Array<{ scope: string }>>(
        `SELECT scope FROM role_scope WHERE role = $1::tenant_user_role ORDER BY scope`,
        [role],
      );

      return rows.map((row) => row.scope);
    }

    // Login is the hottest caller, so resolve override-then-default in one
    // round trip. COALESCE cannot do it: an override of '{}' is a real value
    // meaning "no scopes" and must win over the default, so the fallback is
    // selected on whether the override row exists, not on whether it is empty.
    const rows = await this.runner(manager).query<Array<{ scopes: string[] }>>(
      `SELECT COALESCE(
                (SELECT trs.scopes FROM tenant_role_scope trs
                  WHERE trs.tenant_id = $1 AND trs.role = $2::tenant_user_role),
                (SELECT COALESCE(array_agg(rs.scope ORDER BY rs.scope), '{}')
                   FROM role_scope rs WHERE rs.role = $2::tenant_user_role)
              ) AS scopes`,
      [tenantId, role],
    );

    return rows[0]?.scopes ?? [];
  }

  /** Global default mapping for every role that has seeded scopes. */
  public async findDefaultRoleScopes(
    manager?: EntityManager,
  ): Promise<Record<string, string[]>> {
    const rows = await this.runner(manager).query<
      Array<{ role: string; scopes: string[] }>
    >(
      `SELECT role::text AS role, ARRAY_AGG(scope ORDER BY scope) AS scopes
         FROM role_scope
        GROUP BY role`,
    );

    return Object.fromEntries(rows.map((row) => [row.role, row.scopes]));
  }

  /**
   * Every override row for a tenant.
   *
   * An absent role means "inherit the default"; a present role with an empty
   * array means "deliberately no scopes". Callers must not collapse the two.
   */
  public async findTenantOverrides(
    tenantId: string,
    manager?: EntityManager,
  ): Promise<TenantRoleScopeOverride[]> {
    return this.runner(manager).query<TenantRoleScopeOverride[]>(
      `SELECT role::text AS role, scopes
         FROM tenant_role_scope
        WHERE tenant_id = $1
        ORDER BY role`,
      [tenantId],
    );
  }

  /** One override row, or `null` when the tenant inherits the default. */
  public async findTenantOverride(
    tenantId: string,
    role: string,
    manager?: EntityManager,
  ): Promise<string[] | null> {
    const rows = await this.runner(manager).query<Array<{ scopes: string[] }>>(
      `SELECT scopes FROM tenant_role_scope
        WHERE tenant_id = $1 AND role = $2::tenant_user_role`,
      [tenantId, role],
    );

    return rows.length > 0 ? rows[0].scopes : null;
  }

  /** Replaces a tenant's override for one role. */
  public async upsertTenantRoleScopes(
    tenantId: string,
    role: string,
    scopes: string[],
    manager?: EntityManager,
  ): Promise<void> {
    await this.runner(manager).query(
      `INSERT INTO tenant_role_scope (tenant_id, role, scopes)
       VALUES ($1, $2::tenant_user_role, $3::text[])
       ON CONFLICT (tenant_id, role)
       DO UPDATE SET scopes = EXCLUDED.scopes,
                     updated_at = CURRENT_TIMESTAMP`,
      [tenantId, role, scopes],
    );
  }

  /**
   * Drops a tenant's override so the role reverts to the global default.
   * Returns false when there was nothing to remove.
   */
  public async deleteTenantRoleScopes(
    tenantId: string,
    role: string,
    manager?: EntityManager,
  ): Promise<boolean> {
    const result: unknown = await this.runner(manager).query(
      `DELETE FROM tenant_role_scope
        WHERE tenant_id = $1 AND role = $2::tenant_user_role`,
      [tenantId, role],
    );

    return this.affectedRowCount(result) > 0;
  }

  /**
   * Serializes override writes for one tenant across replicas.
   *
   * Hierarchy validation reads the whole mapping, decides, then writes, so
   * two concurrent writes to different roles can each pass against a stale
   * snapshot and commit a combined state that violates the hierarchy. Row
   * locks cannot prevent it: "inherit the default" is the *absence* of a row,
   * which `FOR UPDATE` has nothing to lock.
   *
   * `hashtext()` returns int4, so the two-key form is the natural fit and the
   * constant class id namespaces this lock against any other advisory lock.
   * The lock releases on commit or rollback, and only blocks writers for the
   * same tenant.
   */
  public async lockTenantForRoleScopeWrite(
    tenantId: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
      ROLE_SCOPE_LOCK_CLASS,
      tenantId,
    ]);
  }

  private runner(manager?: EntityManager): DataSource | EntityManager {
    return manager ?? this.dataSource;
  }

  private affectedRowCount(result: unknown): number {
    // node-postgres returns [rows, affectedCount] for a DELETE via query().
    return Array.isArray(result) && typeof result[1] === 'number'
      ? result[1]
      : 0;
  }
}
