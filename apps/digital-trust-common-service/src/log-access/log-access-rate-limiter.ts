import { Injectable } from '@nestjs/common';

import {
  LOG_ACCESS_RATE_LIMIT_MAX_REQUESTS,
  LOG_ACCESS_RATE_LIMIT_MAX_TENANTS,
  LOG_ACCESS_RATE_LIMIT_WINDOW_MS,
} from './log-access.constants';

interface Bucket {
  windowStart: number;
  count: number;
}

/**
 * Fixed-window, per-tenant request counter (Rule L11). Buckets are keyed by
 * the validated tenant id only, so one tenant's traffic never consumes
 * another's budget. The map is bounded: expired buckets are swept when it
 * is full, and if none are expired new tenants are refused.
 */
@Injectable()
export class LogAccessRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  /** Returns false when the tenant has exhausted its budget. */
  public tryConsume(tenantId: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(tenantId);

    if (
      !bucket ||
      now - bucket.windowStart >= LOG_ACCESS_RATE_LIMIT_WINDOW_MS
    ) {
      this.buckets.delete(tenantId);
      this.sweepExpired(now);

      // Fail closed: evicting a live bucket would reset an exhausted
      // tenant's counter before its window ends.
      if (this.buckets.size >= LOG_ACCESS_RATE_LIMIT_MAX_TENANTS) {
        return false;
      }

      this.buckets.set(tenantId, { windowStart: now, count: 1 });
      return true;
    }

    if (bucket.count >= LOG_ACCESS_RATE_LIMIT_MAX_REQUESTS) {
      return false;
    }

    bucket.count += 1;
    return true;
  }

  private sweepExpired(now: number): void {
    if (this.buckets.size < LOG_ACCESS_RATE_LIMIT_MAX_TENANTS) {
      return;
    }

    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStart >= LOG_ACCESS_RATE_LIMIT_WINDOW_MS) {
        this.buckets.delete(key);
      }
    }
  }
}
