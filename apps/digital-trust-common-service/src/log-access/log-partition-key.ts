const CANONICAL_TENANT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SAFE_PARTITION_KEY = /^[a-z0-9][a-z0-9-]{0,148}$/;

export function isCanonicalTenantId(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_TENANT_ID.test(value);
}

/**
 * A tenant's partition key is `t-` plus its `tenant_id`, with no
 * case folding or trimming. The collector derives the same value
 * independently, so a non-canonical id is rejected rather than normalised.
 */
export function deriveTenantPartitionKey(tenantId: string): string {
  if (!isCanonicalTenantId(tenantId)) {
    throw new Error('tenant_id is not a canonical UUID');
  }

  return `t-${tenantId}`;
}

/**
 * Charset and length guard for keys that reach the scope header. Excludes
 * `|`, which Loki treats as the multi-partition separator and would widen
 * the scope.
 */
export function isSafePartitionKey(value: unknown): value is string {
  return typeof value === 'string' && SAFE_PARTITION_KEY.test(value);
}
