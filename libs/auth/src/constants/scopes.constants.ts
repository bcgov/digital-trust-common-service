/** Level 1 tenant superuser scope — implicitly grants all Level 2 + Level 3 scopes. */
export const TENANT_SUPERUSER_SCOPE = 'tenants:admin';

/** Platform operator role — bypasses ScopeGuard and TenantGuard (not a scope). */
export const PLATFORM_ADMIN_ROLE = 'platform-admin';

/** Level 2 domain-operation scopes. */
export const LEVEL2_SCOPES = [
  'credentials:offer',
  'credentials:verify',
  'credentials:hold',
  'credentials:revoke',
  'connections:manage',
  'profiles:manage',
  'users:manage',
  'clients:manage',
] as const;

/** Level 3 read-only scopes. */
export const LEVEL3_SCOPES = ['logs:read', 'audit:read'] as const;

/** All tenant-level scopes (Level 2 + Level 3, excluding tenants:admin). */
export const ALL_TENANT_SCOPES = [...LEVEL2_SCOPES, ...LEVEL3_SCOPES] as const;

/** Server-wide oidc-provider scope allowlist (openid is always required). */
export const OIDC_SCOPE_ALLOWLIST = [
  'openid',
  TENANT_SUPERUSER_SCOPE,
  ...ALL_TENANT_SCOPES,
] as const;

export type Level2Scope = (typeof LEVEL2_SCOPES)[number];
export type Level3Scope = (typeof LEVEL3_SCOPES)[number];
export type TenantScope = (typeof ALL_TENANT_SCOPES)[number];
