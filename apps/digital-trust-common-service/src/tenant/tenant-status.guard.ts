import {
  AuthenticationRequiredException,
  ScopeAuthorizationService,
} from '@app/auth';
import type { AuthenticatedRequest } from '@app/auth/types/express';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import { TenantNotActiveException } from './tenant-not-active.exception';
import { TenantStatus } from './tenant.entity';
import { TenantRepository } from './tenant.repository';

/**
 * Enforces the tenant lifecycle: a caller whose own tenant is not `ACTIVE`
 * (suspended, deactivated, pending approval, or rejected) gets 403 on every
 * request scoped to that tenant.
 *
 * `TenantGuard` (`@app/auth`) only validates the JWT `tenant_id` claim
 * against a route param; it has no notion of whether that tenant is
 * currently active. This guard closes that gap by looking up the caller's
 * own tenant (`AuthContext.tenantId`) and rejecting anything but `ACTIVE`.
 *
 * - platform-admin -> bypass (must still be able to manage, including
 *   reactivate, a suspended/deactivated tenant).
 * - No `auth.tenantId` -> allow; there is nothing to check.
 * - Tenant record not found (soft-deleted or unknown) -> block. `findById`
 *   excludes soft-deleted rows, so this is the same lifecycle gap as any
 *   other non-active status and should fail closed, not open.
 */
@Injectable()
export class TenantStatusGuard implements CanActivate {
  public constructor(
    private readonly scopeAuthorizationService: ScopeAuthorizationService,
    private readonly tenants: TenantRepository,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = request.auth;

    // Missing auth means JwtGuard did not run (or failed to attach
    // context). Fail closed rather than allowing the request through
    // unauthenticated (mirrors TenantGuard's handling of the same case).
    if (!auth) {
      throw new AuthenticationRequiredException(
        'invalid_token',
        'Authenticated request context is missing',
      );
    }

    if (this.scopeAuthorizationService.isPlatformAdmin(auth.roles)) {
      return true;
    }

    if (!auth.tenantId) {
      return true;
    }

    const tenant = await this.tenants.findById(auth.tenantId);

    if (!tenant) {
      throw new TenantNotActiveException(
        'Tenant could not be found and cannot perform this action',
        TenantStatus.DEACTIVATED,
      );
    }

    if (tenant.status !== TenantStatus.ACTIVE) {
      throw new TenantNotActiveException(
        `Tenant is ${tenant.status} and cannot perform this action`,
        tenant.status,
      );
    }

    return true;
  }
}
