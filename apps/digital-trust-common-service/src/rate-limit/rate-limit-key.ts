const KEY_SEPARATOR = '::';

/**
 * Builds the opaque `key` string `@nestjs/throttler`'s `ThrottlerStorage`
 * interface passes to `increment()`. `TenantRateLimitGuard` overrides
 * `generateKey()` to produce this format instead of the library's default
 * SHA-256 hash, so `RateLimitStorageService` can recover the structured
 * `tracker`/`routeKey` needed to query `rate_limit_hits`.
 */
export function buildRateLimitKey(tracker: string, routeKey: string): string {
  return `${tracker}${KEY_SEPARATOR}${routeKey}`;
}

export function parseRateLimitKey(key: string): {
  tracker: string;
  routeKey: string;
} {
  const separatorIndex = key.indexOf(KEY_SEPARATOR);

  if (separatorIndex === -1) {
    throw new Error(`Malformed rate limit key: ${key}`);
  }

  return {
    tracker: key.slice(0, separatorIndex),
    routeKey: key.slice(separatorIndex + KEY_SEPARATOR.length),
  };
}
