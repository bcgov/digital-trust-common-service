import type { AuthUser } from './types';

export const TENANT_ADMIN_SCOPE = 'tenants:admin';
export const USERS_MANAGE_SCOPE = 'users:manage';
export const PLATFORM_ADMIN_ROLE = 'platform-admin';

// Tenant creation is guarded by the platform-admin role, not a scope, so a
// tenant owner's `tenants:admin` does not grant it.
export function isPlatformAdmin(
  user: Partial<Pick<AuthUser, 'roles'>> | null | undefined,
): boolean {
  return user?.roles?.includes(PLATFORM_ADMIN_ROLE) === true;
}

/**
 * Match API authorization: platform-admin bypasses scope checks, and
 * `tenants:admin` (owner) implies every other scope.
 * The token lags a role change by one refresh, so pages still handle a 403.
 */
export function hasScope(
  user:
    | (Pick<AuthUser, 'scopes'> & Partial<Pick<AuthUser, 'roles'>>)
    | null
    | undefined,
  scope: string,
): boolean {
  if (!user) return false;
  return (
    user.roles?.includes(PLATFORM_ADMIN_ROLE) === true ||
    user.scopes.includes(scope) ||
    user.scopes.includes(TENANT_ADMIN_SCOPE)
  );
}
