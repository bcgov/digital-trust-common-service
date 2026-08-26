import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import { AuthenticationRequiredException } from '../exceptions/authentication-required.exception';
import { TenantAccessDeniedException } from '../exceptions/tenant-access-denied.exception';
import { ScopeAuthorizationService } from '../services/scope-authorization.service';
import type { AuthenticatedRequest } from '../types/express';

/**
 * Enforces JWT `tenant_id` claim-match against route `:tenantId` (AU-05).
 *
 * - No `:tenantId` (or empty) → no-op allow (safe on mixed/admin stacks).
 * - `platform-admin` → bypass and still stamp `request.tenantId` when present.
 * - Live TenantUser membership is checked at token issuance (login / AU-09).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  public constructor(
    private readonly scopeAuthorizationService: ScopeAuthorizationService,
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = request.auth;

    // Missing auth means JwtGuard did not run (or failed to attach context).
    // That is an authentication failure (401), not tenant access denied (403).
    if (!auth) {
      throw new AuthenticationRequiredException(
        'invalid_token',
        'Authenticated request context is missing',
      );
    }

    const routeTenantId = this.resolveRouteTenantId(request);

    if (!routeTenantId) {
      return true;
    }

    if (this.scopeAuthorizationService.isPlatformAdmin(auth.roles)) {
      request.tenantId = routeTenantId;
      return true;
    }

    if (!auth.tenantId) {
      throw new TenantAccessDeniedException(
        'Token is missing a tenant_id claim',
        {
          requiredTenantId: routeTenantId,
          tokenTenantId: null,
        },
      );
    }

    if (auth.tenantId !== routeTenantId) {
      throw new TenantAccessDeniedException(
        'Token tenant_id does not match the requested tenant',
        {
          requiredTenantId: routeTenantId,
          tokenTenantId: auth.tenantId,
        },
      );
    }

    request.tenantId = routeTenantId;
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
