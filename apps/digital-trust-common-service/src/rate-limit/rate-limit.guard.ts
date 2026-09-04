import { ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
} from '@nestjs/throttler';
import type {
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';

import { buildRateLimitKey } from './rate-limit-key';

/**
 * Global pre-auth flood protection: keys every request on the caller's IP
 * (`req.ip`, the real client address rather than the reverse proxy's,
 * because `configureApp()` enables Express's `trust proxy` setting — see
 * that function's comment for why), regardless of tenant, route, or
 * whether the request goes on to authenticate successfully. Registered as
 * a global `APP_GUARD` so it also covers unauthenticated/malformed
 * requests, which never reach a per-controller guard.
 *
 * This is deliberately identity-agnostic. The separate, tenant-tier quota
 * (standard vs. premium requests-per-minute) is enforced by
 * `TenantTierRateLimitGuard`, applied per-controller *after* `TenantGuard`
 * so it can key on the JWT-verified tenant rather than an unauthenticated
 * caller's guess at a tenant id from the URL — see that guard's doc
 * comment.
 *
 * Only `getTracker`/`generateKey`/`shouldSkip` are overridden here; ttl and
 * the flat limit are configured on the `ThrottlerModule` options, and
 * per-endpoint overrides for expensive operations use the standard
 * `@Throttle()` decorator — see `rate-limit.module.ts`.
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  public constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly config: ConfigService,
  ) {
    super(options, storageService, reflector);
  }

  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (await super.shouldSkip(context)) {
      return true;
    }

    const enabled =
      this.config.get<string>('RATE_LIMIT_ENABLED', 'true') !== 'false';

    return !enabled;
  }

  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const ip = req.ip as string | undefined;
    return Promise.resolve(ip ?? 'unknown');
  }

  protected generateKey(
    context: ExecutionContext,
    tracker: string,
    _throttlerName: string,
  ): string {
    const routeKey = `${context.getClass().name}.${context.getHandler().name}`;
    return buildRateLimitKey(tracker, routeKey);
  }
}
