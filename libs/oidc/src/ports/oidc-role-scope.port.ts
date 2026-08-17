import type { OidcTenantUserRole } from './oidc-tenant-user.port';

export interface OidcRoleScopePort {
  findScopesForRole(role: OidcTenantUserRole): Promise<string[]>;
}

export const OIDC_ROLE_SCOPE_PORT = 'OIDC_ROLE_SCOPE_PORT';
