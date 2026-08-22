import type { OidcTenantUserRole } from './oidc-tenant-user.port';

export interface OidcRoleScopePort {
  /**
   * Effective scopes for a role. `tenantId` selects the tenant's override
   * when one exists; omitting it returns the platform default.
   *
   * Optional rather than a required leading argument so existing callers and
   * test doubles keep compiling (AU-07 #40).
   */
  findScopesForRole(
    role: OidcTenantUserRole,
    tenantId?: string,
  ): Promise<string[]>;
}

export const OIDC_ROLE_SCOPE_PORT = 'OIDC_ROLE_SCOPE_PORT';
