export type RateLimitTier = 'standard' | 'premium';

/**
 * Reads the per-tenant rate-limit tier from `Tenant.config` (an untyped
 * jsonb column): `{ rate_limits: { tier: 'standard' | 'premium' } }`. This
 * is the same reserved `rate_limits` key `TenantService.updateConfig`
 * already protects from `PATCH /tenants/{tenantId}/config` — the tier
 * lives alongside whatever other rate-limit overrides that key may one
 * day hold. Anything else — including a missing/malformed value —
 * defaults to `'standard'`, so a tenant is never accidentally granted the
 * higher premium ceiling by a typo or partial config.
 */
export function resolveRateLimitTier(
  config: Record<string, unknown> | null | undefined,
): RateLimitTier {
  const rateLimits = config?.rate_limits;

  if (typeof rateLimits !== 'object' || rateLimits === null) {
    return 'standard';
  }

  const tier = (rateLimits as { tier?: unknown }).tier;

  return tier === 'premium' ? 'premium' : 'standard';
}
