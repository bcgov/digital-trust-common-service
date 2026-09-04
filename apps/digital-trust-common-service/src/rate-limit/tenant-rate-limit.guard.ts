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

import { RATE_LIMIT_BY_CALLER_KEY } from './rate-limit-by-caller.decorator';
import { buildRateLimitKey } from './rate-limit-key';

/**
 * Keys the rate limit on the target tenant (the route's `:tenantId` param)
 * rather than the caller's identity. This lets the guard run as a global
 * `APP_GUARD` ahead of `JwtGuard`/`TenantStatusGuard` without depending on
 * JWT claims those guards attach later in the chain. Routes with no
 * `:tenantId` param (platform-admin/global endpoints), and routes marked
 * with `@RateLimitByCaller()`, fall back to the caller's IP (`req.ip`) —
 * this reflects the real client IP, not the reverse proxy's, only because
 * `configureApp()` enables Express's `trust proxy` setting; see that
 * function's comment for why.
 *
 * Only `getTracker`/`generateKey`/`shouldSkip` are overridden here;
 * limit/ttl resolution (including the standard-vs-premium tenant tier
 * lookup) is configured on the `ThrottlerModule` options, and per-endpoint
 * overrides for expensive operations use the standard `@Throttle()`
 * decorator — see `rate-limit.module.ts`.
 */
@Injectable()
export class TenantRateLimitGuard extends ThrottlerGuard {
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

  protected getTracker(
    req: Record<string, unknown>,
    context?: ExecutionContext,
  ): Promise<string> {
    const ip = req.ip as string | undefined;
    const byCaller =
      context !== undefined &&
      this.reflector.getAllAndOverride<boolean>(RATE_LIMIT_BY_CALLER_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);

    if (byCaller) {
      return Promise.resolve(ip ?? 'unknown');
    }

    const params = req.params as Record<string, string> | undefined;
    return Promise.resolve(params?.tenantId ?? ip ?? 'unknown');
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
