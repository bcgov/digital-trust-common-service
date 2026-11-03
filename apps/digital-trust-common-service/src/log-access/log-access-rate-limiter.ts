import { Injectable } from '@nestjs/common';

import { buildRateLimitKey } from '../rate-limit/rate-limit-key';
import { RateLimitStorageService } from '../rate-limit/rate-limit-storage.service';

import {
  LOG_ACCESS_RATE_LIMIT_MAX_REQUESTS,
  LOG_ACCESS_RATE_LIMIT_ROUTE_KEY,
  LOG_ACCESS_RATE_LIMIT_WINDOW_MS,
} from './log-access.constants';

/**
 * Per-tenant request budget for the decision endpoint, counted
 * in the shared `rate_limit_hits` table under a dedicated route key so it
 * holds across replicas and never mixes with API budgets. Keyed by the
 * validated tenant id only, so one tenant never consumes another's budget.
 */
@Injectable()
export class LogAccessRateLimiter {
  public constructor(private readonly storage: RateLimitStorageService) {}

  /** Returns false when the tenant has exhausted its budget. */
  public async tryConsume(tenantId: string): Promise<boolean> {
    const { isBlocked } = await this.storage.increment(
      buildRateLimitKey(tenantId, LOG_ACCESS_RATE_LIMIT_ROUTE_KEY),
      LOG_ACCESS_RATE_LIMIT_WINDOW_MS,
      LOG_ACCESS_RATE_LIMIT_MAX_REQUESTS,
      LOG_ACCESS_RATE_LIMIT_WINDOW_MS,
      LOG_ACCESS_RATE_LIMIT_ROUTE_KEY,
    );

    return !isBlocked;
  }
}
