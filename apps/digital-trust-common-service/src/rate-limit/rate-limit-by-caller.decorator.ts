import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_BY_CALLER_KEY = 'rateLimitByCaller';

/**
 * Keys this route's rate limit on the caller (IP) instead of the route's
 * `:tenantId` param, and resolves the flat standard limit rather than the
 * target tenant's tier. Use this on admin routes that take a tenant id as
 * their subject rather than act "as" that tenant.
 *
 * Without this, an admin action like resetting a tenant's rate limit would
 * itself be keyed on — and counted against — the target tenant: the reset
 * would never be idempotent (the reset request itself always adds a hit,
 * so `deleted_count` could never be `0`), and the guard would 429 the
 * request before the handler ran once that tenant is already blocked,
 * defeating its purpose as an admin escape hatch.
 */
export const RateLimitByCaller = (): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_BY_CALLER_KEY, true);
