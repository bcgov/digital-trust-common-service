/** Path prefix Envoy's `ext_authz` filter prepends to the original request. */
export const LOG_ACCESS_INTERNAL_PATH = 'internal/log-access/check';

export const SCOPE_HEADER = 'X-Scope-OrgID';

/** A single scope never exceeds ten partitions. */
export const MAX_PARTITIONS_PER_SCOPE = 10;

export const LOG_READ_SCOPE = 'logs:read';

export const AGENT_LOG_PARTITION_RESOLVER = Symbol(
  'AGENT_LOG_PARTITION_RESOLVER',
);
