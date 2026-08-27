/** Level 1 tenant superuser scope — implicitly grants all Level 2 + Level 3 scopes. */
export const TENANT_SUPERUSER_SCOPE = 'tenants:admin';

/** Platform operator role — bypasses ScopeGuard and TenantGuard (not a scope). */
export const PLATFORM_ADMIN_ROLE = 'platform-admin';

/**
 * JWT roles that are platform-wide privilege escalations. Assigning or
 * clearing these on an OAuth client requires a platform-admin caller.
 */
export const OAUTH_CLIENT_PLATFORM_ROLES = [PLATFORM_ADMIN_ROLE] as const;

/** Level 2 scope for managing tenant users (invite, list, update, remove). */
export const USERS_MANAGE_SCOPE = 'users:manage';

/** Level 2 scope for connection CRUD. */
export const CONNECTIONS_MANAGE_SCOPE = 'connections:manage';

/** Level 2 scope for OAuth / API client registration. */
export const CLIENTS_MANAGE_SCOPE = 'clients:manage';

/** Level 3 scope for the tenant audit-log API. */
export const AUDIT_READ_SCOPE = 'audit:read';

/** Level 2 domain-operation scopes. */
export const LEVEL2_SCOPES = [
  'credentials:offer',
  'credentials:verify',
  'credentials:hold',
  'credentials:revoke',
  CONNECTIONS_MANAGE_SCOPE,
  'profiles:manage',
  USERS_MANAGE_SCOPE,
  CLIENTS_MANAGE_SCOPE,
] as const;

/** Level 3 read-only scopes. */
export const LEVEL3_SCOPES = ['logs:read', AUDIT_READ_SCOPE] as const;

/** All tenant-level scopes (Level 2 + Level 3, excluding tenants:admin). */
export const ALL_TENANT_SCOPES = [...LEVEL2_SCOPES, ...LEVEL3_SCOPES] as const;

/**
 * Scopes that may be assigned to an OAuth client at registration/update.
 * `openid` is an OIDC protocol scope, not an API permission, so it is omitted.
 */
export const ASSIGNABLE_OAUTH_CLIENT_SCOPES = [
  TENANT_SUPERUSER_SCOPE,
  ...ALL_TENANT_SCOPES,
] as const;

/** Server-wide oidc-provider scope allowlist (openid is always required). */
export const OIDC_SCOPE_ALLOWLIST = [
  'openid',
  TENANT_SUPERUSER_SCOPE,
  ...ALL_TENANT_SCOPES,
] as const;

export type Level2Scope = (typeof LEVEL2_SCOPES)[number];
export type Level3Scope = (typeof LEVEL3_SCOPES)[number];
export type TenantScope = (typeof ALL_TENANT_SCOPES)[number];

export interface ScopeCatalogEntry {
  name: string;
  description: string;
  level: number;
}

/**
 * Public scope catalog served by `GET /api/v1/scopes` (AU-07).
 *
 * Enumerated by hand rather than derived from `ALL_TENANT_SCOPES`, which
 * excludes `tenants:admin` and would silently drop the Level 1 scope from
 * the published catalog.
 */
export const SCOPE_CATALOG: readonly ScopeCatalogEntry[] = [
  {
    name: TENANT_SUPERUSER_SCOPE,
    description:
      'Tenant superuser. Implicitly grants every Level 2 and Level 3 scope.',
    level: 1,
  },
  {
    name: 'credentials:offer',
    description: 'Issue credential offers.',
    level: 2,
  },
  {
    name: 'credentials:verify',
    description: 'Request and verify presentations.',
    level: 2,
  },
  {
    name: 'credentials:hold',
    description: 'Accept or reject credential offers.',
    level: 2,
  },
  {
    name: 'credentials:revoke',
    description: 'Revoke issued credentials.',
    level: 2,
  },
  {
    name: CONNECTIONS_MANAGE_SCOPE,
    description: 'Create, list, and delete connections.',
    level: 2,
  },
  {
    name: 'profiles:manage',
    description: 'Manage issuance and verification profiles.',
    level: 2,
  },
  {
    name: 'users:manage',
    description: 'Invite, update, and remove tenant users.',
    level: 2,
  },
  {
    name: CLIENTS_MANAGE_SCOPE,
    description: 'Register and revoke API clients.',
    level: 2,
  },
  {
    name: 'logs:read',
    description: 'View tenant observability logs.',
    level: 3,
  },
  {
    name: AUDIT_READ_SCOPE,
    description: 'Read the tenant audit log API.',
    level: 3,
  },
] as const;

const KNOWN_SCOPES = new Set(SCOPE_CATALOG.map((entry) => entry.name));

/** True when `scope` appears in {@link SCOPE_CATALOG}. */
export function isKnownScope(scope: string): boolean {
  return KNOWN_SCOPES.has(scope);
}

/**
 * Tenant user roles ordered most to least privileged.
 *
 * AU-07 enforces "child scopes must be a subset of parent scopes" over
 * adjacent pairs of this list. Comparison runs on *expanded* scopes: `owner`
 * carries only `tenants:admin`, so a raw set comparison would report the
 * seeded defaults as invalid.
 */
export const ROLE_HIERARCHY = ['owner', 'admin', 'member', 'readonly'] as const;

export type TenantRole = (typeof ROLE_HIERARCHY)[number];

/**
 * Tenant-scoped JWT roles a tenant admin may stamp on their own machine
 * clients. Distinct from {@link OAUTH_CLIENT_PLATFORM_ROLES}.
 */
export const OAUTH_CLIENT_TENANT_ROLES = ROLE_HIERARCHY;

/**
 * Roles that may be persisted on OAuth clients and stamped into machine tokens.
 * Keep this tight: roles are privilege escalations, not free-form labels.
 */
export const OAUTH_CLIENT_ALLOWED_ROLES = [
  ...OAUTH_CLIENT_TENANT_ROLES,
  ...OAUTH_CLIENT_PLATFORM_ROLES,
] as const;
