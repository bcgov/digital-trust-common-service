import type { AuthenticatedRequest } from '@app/auth/types/express';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';

import { TenantRepository } from '../tenant/tenant.repository';

import { buildRateLimitKey } from './rate-limit-key';
import { RateLimitStorageService } from './rate-limit-storage.service';
import { resolveRateLimitTier } from './rate-limit-tier';

/**
 * Per-tenant quota (standard vs. premium requests-per-minute), applied
 * per-controller with `@UseGuards(..., TenantGuard, TenantTierRateLimitGuard)`
 * rather than as a global `APP_GUARD`.
 *
 * `RateLimitGuard` (the global guard) tracks the caller's IP and runs
 * before authentication, so it cannot key on a tenant without letting an
 * unauthenticated caller who merely knows a tenant's (non-secret) UUID
 * exhaust that tenant's quota, or spend it on requests that fail auth
 * entirely. This guard closes that gap by reading `request.tenantId`,
 * which `TenantGuard` stamps only after verifying it against the caller's
 * own JWT `tenant_id` claim — so it must be listed after `TenantGuard` in
 * every controller's `@UseGuards()`.
 *
 * No route tenantId (`request.tenantId` unset) -> allow; there is no
 * tenant quota to enforce.
 */
@Injectable()
export class TenantTierRateLimitGuard implements CanActivate {
  public constructor(
    private readonly storage: RateLimitStorageService,
    private readonly tenants: TenantRepository,
    private readonly config: ConfigService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const enabled =
      this.config.get<string>('RATE_LIMIT_ENABLED', 'true') !== 'false';

    if (!enabled) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const tenantId = request.tenantId;

    if (!tenantId) {
      return true;
    }

    const ttl = Number(
      this.config.get<string>('RATE_LIMIT_WINDOW_MS', '60000'),
    );
    const standardLimit = Number(
      this.config.get<string>('RATE_LIMIT_STANDARD_PER_MINUTE', '100'),
    );
    const premiumLimit = Number(
      this.config.get<string>('RATE_LIMIT_PREMIUM_PER_MINUTE', '1000'),
    );
    const tenant = await this.tenants.findById(tenantId);
    const tier = resolveRateLimitTier(tenant?.config);
    const limit = tier === 'premium' ? premiumLimit : standardLimit;

    const routeKey = `${context.getClass().name}.${context.getHandler().name}`;
    const key = buildRateLimitKey(tenantId, routeKey);
    const { isBlocked, timeToBlockExpire } = await this.storage.increment(
      key,
      ttl,
      limit,
      ttl,
      'tenant-tier',
    );

    if (isBlocked) {
      const response = context.switchToHttp().getResponse<Response>();
      response.header('Retry-After', String(timeToBlockExpire));
      throw new ThrottlerException();
    }

    return true;
  }
}
