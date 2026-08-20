import {
  AuthenticationRequiredException,
  ScopeAuthorizationService,
} from '@app/auth';
import type { AuthenticatedRequest } from '@app/auth/types/express';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { InsufficientTenantRoleException } from './insufficient-tenant-role.exception';
import { REQUIRED_TENANT_ROLES_KEY } from './require-tenant-roles.decorator';
import {
  TenantUser,
  TenantUserRole,
  TenantUserStatus,
} from './tenant-user.entity';
import { TenantUserRepository } from './tenant-user.repository';

export type TenantScopedRequest = AuthenticatedRequest & {
  /**
   * The caller's own TenantUser row for the route tenant, resolved by
   * {@link TenantMembershipGuard}. Undefined for platform-admin callers
   * (who bypass the membership check) or when no role gate applies.
   */
  callerTenantUser?: TenantUser;
};

/**
 * Enforces DB-level TenantUser.role membership for tenant-user management
 * routes (AU-09).
 *
 * `TenantGuard` only validates the JWT `tenant_id` claim against the route;
 * it has no notion of the caller's *role* within that tenant. This guard
 * closes that gap by looking up the caller's own TenantUser row (matched
 * via `AuthContext.sub`) and checking its role against
 * `@RequireTenantRoles(...)`.
 *
 * - platform-admin -> bypass (no TenantUser row required).
 * - No `@RequireTenantRoles(...)` on the handler/class -> no-op allow.
 * - Otherwise the caller must have an active TenantUser row for the route
 *   tenant whose role is one of the required roles; the resolved row is
 *   stamped on `request.callerTenantUser` so handlers/services can enforce
 *   self-action rules (e.g. a caller may not change their own role)
 *   without a second lookup.
 */
@Injectable()
export class TenantMembershipGuard implements CanActivate {
  public constructor(
    private readonly reflector: Reflector,
    private readonly scopeAuthorizationService: ScopeAuthorizationService,
    private readonly tenantUserRepository: TenantUserRepository,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TenantScopedRequest>();
    const auth = request.auth;

    // Missing auth means JwtGuard did not run (or failed to attach context).
    // Fail closed rather than allowing the request through unauthenticated
    // (mirrors TenantGuard's handling of the same condition).
    if (!auth) {
      throw new AuthenticationRequiredException(
        'invalid_token',
        'Authenticated request context is missing',
      );
    }

    if (this.scopeAuthorizationService.isPlatformAdmin(auth.roles)) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<TenantUserRole[]>(
      REQUIRED_TENANT_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const roles = requiredRoles ?? [];

    if (roles.length === 0) {
      return true;
    }

    const tenantId = this.resolveRouteTenantId(request);

    if (!tenantId) {
      return true;
    }

    const callerTenantUser =
      await this.tenantUserRepository.findByTenantAndExternalUserId(
        tenantId,
        auth.sub,
      );

    if (
      !callerTenantUser ||
      callerTenantUser.status !== TenantUserStatus.ACTIVE ||
      !roles.includes(callerTenantUser.role)
    ) {
      throw new InsufficientTenantRoleException(
        'Caller does not have a sufficient tenant role for this action',
        { requiredTenantRoles: roles },
      );
    }

    request.callerTenantUser = callerTenantUser;

    return true;
  }

  private resolveRouteTenantId(request: AuthenticatedRequest): string | null {
    const raw = request.params?.tenantId;

    if (typeof raw !== 'string') {
      return null;
    }

    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
