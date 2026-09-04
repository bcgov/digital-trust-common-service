const KEY_SEPARATOR = '::';

/**
 * Builds the opaque `key` string `@nestjs/throttler`'s `ThrottlerStorage`
 * interface passes to `increment()`. `RateLimitGuard` overrides
 * `generateKey()` to produce this format instead of the library's default
 * SHA-256 hash, so `RateLimitStorageService` can recover the structured
 * `tracker`/`routeKey` needed to query `rate_limit_hits`.
 *
 * `tracker` and `routeKey` are each `encodeURIComponent`-escaped before
 * joining. `tracker` is the caller's IP for `RateLimitGuard`, or a tenant
 * id for `TenantTierRateLimitGuard`, and IPv6 (or IPv6-mapped IPv4, e.g.
 * `::ffff:127.0.0.1`) addresses themselves contain the `::` separator —
 * encoding guarantees the only literal `::` left in the built key is the
 * real separator, so `parseRateLimitKey`'s `indexOf` lookup can't be
 * fooled into splitting in the middle of a tracker value.
 */
export function buildRateLimitKey(tracker: string, routeKey: string): string {
  return `${encodeURIComponent(tracker)}${KEY_SEPARATOR}${encodeURIComponent(routeKey)}`;
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
    tracker: decodeURIComponent(key.slice(0, separatorIndex)),
    routeKey: decodeURIComponent(
      key.slice(separatorIndex + KEY_SEPARATOR.length),
    ),
  };
}
