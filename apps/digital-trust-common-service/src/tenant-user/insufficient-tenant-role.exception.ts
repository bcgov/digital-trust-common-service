import { HttpException, HttpStatus } from '@nestjs/common';

export interface InsufficientTenantRoleErrorBody {
  error: {
    code: 'INSUFFICIENT_TENANT_ROLE';
    message: string;
    required_tenant_roles?: string[];
  };
}

/**
 * Thrown by {@link TenantMembershipGuard} when the caller either has no
 * TenantUser record for the route tenant, or has one whose role is not
 * included in the handler's `@RequireTenantRoles(...)` list.
 *
 * Distinct from `TenantAccessDeniedException` (JWT `tenant_id` claim
 * mismatch) and `InsufficientScopeException` (missing OAuth scope/role) —
 * this is specifically about DB-level TenantUser.role membership.
 */
export class InsufficientTenantRoleException extends HttpException {
  public constructor(
    message: string,
    options: { requiredTenantRoles?: string[] } = {},
  ) {
    const body: InsufficientTenantRoleErrorBody = {
      error: {
        code: 'INSUFFICIENT_TENANT_ROLE',
        message,
        ...(options.requiredTenantRoles &&
        options.requiredTenantRoles.length > 0
          ? { required_tenant_roles: [...options.requiredTenantRoles] }
          : {}),
      },
    };

    super(body, HttpStatus.FORBIDDEN);
  }
}
