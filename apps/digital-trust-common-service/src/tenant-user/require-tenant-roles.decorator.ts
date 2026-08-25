import { SetMetadata } from '@nestjs/common';

import { TenantUserRole } from './tenant-user.entity';

export const REQUIRED_TENANT_ROLES_KEY = 'required_tenant_roles';

/**
 * Require the caller's own DB-level TenantUser.role (for the route tenant)
 * to be one of the listed roles (OR logic). Checked by
 * {@link TenantMembershipGuard} after JwtGuard/ScopeGuard/TenantGuard.
 */
export const RequireTenantRoles = (...roles: TenantUserRole[]) =>
  SetMetadata(REQUIRED_TENANT_ROLES_KEY, roles);
