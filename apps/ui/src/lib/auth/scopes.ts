import type { AuthUser } from './types';

export const TENANT_ADMIN_SCOPE = 'tenants:admin';
export const USERS_MANAGE_SCOPE = 'users:manage';

/**
 * Gate privileged UI on the token's scopes, not on role names: the API
 * authorizes by scope, and `tenants:admin` (owner) implies every other one.
 * The token lags a role change by one refresh, so pages still handle a 403.
 */
export function hasScope(
  user: Pick<AuthUser, 'scopes'> | null | undefined,
  scope: string,
): boolean {
  if (!user) return false;
  return (
    user.scopes.includes(scope) || user.scopes.includes(TENANT_ADMIN_SCOPE)
  );
}
