import {
  PLATFORM_ADMIN_ROLE,
  TenantAccessDeniedException,
  type AuthContext,
} from '@app/auth';
import { NotFoundException } from '@nestjs/common';

/**
 * Claim-match for create/body routes where the caller explicitly names a
 * tenant. Mismatch → 403 TENANT_ACCESS_DENIED. Platform-admin bypasses.
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

/**
 * Claim-match after loading a resource by id. Cross-tenant (or missing
 * tenant claim) → 404 with the same message as a missing row, so callers
 * cannot probe other tenants' resource ids. Platform-admin bypasses.
 */
export function assertResourceTenantOrNotFound(
  auth: AuthContext | undefined,
  resourceTenantId: string,
  notFoundMessage: string,
): void {
  if (!auth) {
    throw new NotFoundException(notFoundMessage);
  }

  if (auth.roles.includes(PLATFORM_ADMIN_ROLE)) {
    return;
  }

  if (!auth.tenantId || auth.tenantId !== resourceTenantId) {
    throw new NotFoundException(notFoundMessage);
  }
}

export function isPlatformAdmin(auth: AuthContext | undefined): boolean {
  return Boolean(auth?.roles.includes(PLATFORM_ADMIN_ROLE));
}
