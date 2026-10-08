import type { AuthUser } from './types';

export const TENANT_ADMIN_SCOPE = 'tenants:admin';
export const USERS_MANAGE_SCOPE = 'users:manage';

/** Mirrors @app/auth's PLATFORM_ADMIN_ROLE: a JWT role, not a scope. */
export const PLATFORM_ADMIN_ROLE = 'platform-admin';

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

/**
 * Platform operators manage tenants themselves rather than operating inside
 * one, and the API bypasses scope/tenant checks for them entirely — the UI
 * surfaces this as a distinct, labelled context rather than folding it into
 * tenant role copy.
 */
export function isPlatformAdmin(
  user: Pick<AuthUser, 'roles'> | null | undefined,
): boolean {
  return Boolean(user?.roles.includes(PLATFORM_ADMIN_ROLE));
}
