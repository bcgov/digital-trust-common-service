import {
  PLATFORM_ADMIN_ROLE,
  TenantAccessDeniedException,
  type AuthContext,
} from '@app/auth';

/**
 * Claim-match helper for routes where TenantGuard cannot see the tenant
 * (body `tenantId`, or resource loaded by `:id`). Platform-admin bypasses.
 */
export function assertTenantAccess(
  auth: AuthContext | undefined,
  tenantId: string,
): void {
  if (!auth) {
    throw new TenantAccessDeniedException(
      'Authenticated request context is missing',
      {
        requiredTenantId: tenantId,
        tokenTenantId: null,
      },
    );
  }

  if (auth.roles.includes(PLATFORM_ADMIN_ROLE)) {
    return;
  }

  if (!auth.tenantId) {
    throw new TenantAccessDeniedException(
      'Token is missing a tenant_id claim',
      {
        requiredTenantId: tenantId,
        tokenTenantId: null,
      },
    );
  }

  if (auth.tenantId !== tenantId) {
    throw new TenantAccessDeniedException(
      'Token tenant_id does not match the requested tenant',
      {
        requiredTenantId: tenantId,
        tokenTenantId: auth.tenantId,
      },
    );
  }
}

export function isPlatformAdmin(auth: AuthContext | undefined): boolean {
  return Boolean(auth?.roles.includes(PLATFORM_ADMIN_ROLE));
}
