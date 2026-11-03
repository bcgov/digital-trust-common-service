/** Path prefix Envoy's `ext_authz` filter prepends to the original request. */
export const LOG_ACCESS_INTERNAL_PATH = 'internal/log-access/check';

export const SCOPE_HEADER = 'X-Scope-OrgID';

/** A single scope never exceeds ten partitions. */
export const MAX_PARTITIONS_PER_SCOPE = 10;

export const LOG_READ_SCOPE = 'logs:read';

export const AGENT_LOG_PARTITION_RESOLVER = Symbol(
  'AGENT_LOG_PARTITION_RESOLVER',
);

/** Per-tenant request budget on the decision endpoint (Rule L11). */
export const LOG_ACCESS_RATE_LIMIT_MAX_REQUESTS = 120;
export const LOG_ACCESS_RATE_LIMIT_WINDOW_MS = 60_000;
/** Dedicated `rate_limit_hits` route key, separate from API budgets. */
export const LOG_ACCESS_RATE_LIMIT_ROUTE_KEY = 'log-access';

/** Lower-case names that would select a tenant if honoured (Rules S4, S6). */
export const TENANT_SELECTING_PARAMETERS: ReadonlySet<string> = new Set([
  'tenant',
  'org',
  'scope',
  'tenant_id',
  'tenantid',
  'org_id',
  'orgid',
  'x-scope-orgid',
  'scope_orgid',
]);
