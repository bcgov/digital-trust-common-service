import type { AuthUser } from './types';

export const TENANT_ADMIN_SCOPE = 'tenants:admin';
export const USERS_MANAGE_SCOPE = 'users:manage';

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
    user.roles?.includes('platform-admin') === true ||
    user.scopes.includes(scope) || user.scopes.includes(TENANT_ADMIN_SCOPE)
  );
}
