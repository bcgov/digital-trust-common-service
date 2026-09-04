import { Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';

import { RateLimitHitRepository } from './rate-limit-hit.repository';
import { parseRateLimitKey } from './rate-limit-key';

/**
 * Mirrors `@nestjs/throttler`'s `ThrottlerStorageRecord` shape. Not
 * importable from the package: its barrel re-exports `ThrottlerStorage`
 * but not the record type, so this is declared locally and satisfies the
 * interface structurally.
 */
interface RateLimitStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Postgres-backed `ThrottlerStorage`: each request is INSERTed as a row in
 * `rate_limit_hits` (keyed by `tracker` — a tenant id, or the caller IP for
 * routes with no tenant), and the limit check COUNTs rows for the same key
 * within a sliding `ttl`-millisecond window. This replaces
 * `@nestjs/throttler`'s built-in in-memory storage (a fixed window plus a
 * separate blocked state held in process memory), which would not survive
 * a restart or work across replicas.
 *
 * `timeToExpire`/`timeToBlockExpire` are approximated as the full window
 * length in seconds: with a sliding window there is no single instant at
 * which the count resets (it decreases gradually as old hits age out of
 * the window), so the window length is used as a safe upper bound for the
 * `Retry-After` header rather than computing the exact age of the oldest
 * in-window hit.
 */
@Injectable()
export class RateLimitStorageService implements ThrottlerStorage {
  public constructor(private readonly hits: RateLimitHitRepository) {}

  public async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName: string,
  ): Promise<RateLimitStorageRecord> {
    const { tracker, routeKey } = parseRateLimitKey(key);

    await this.hits.recordHit(tracker, routeKey);

    const since = new Date(Date.now() - ttl);
    const totalHits = await this.hits.countSince(tracker, routeKey, since);
    const isBlocked = totalHits > limit;

    return {
      totalHits,
      timeToExpire: Math.ceil(ttl / 1000),
      isBlocked,
      timeToBlockExpire: isBlocked
        ? Math.ceil((blockDuration || ttl) / 1000)
        : 0,
    };
  }
}
