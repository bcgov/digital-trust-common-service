export type LogAccessDenialReason =
  | 'audience_not_configured'
  | 'invalid_token'
  | 'invalid_tenant_id'
  | 'missing_logs_read_scope'
  | 'resolution_failed'
  | 'partition_bound_exceeded';

/**
 * Carries the operator-facing reason for a denial. The reason is for logs
 * only; the caller sees one fixed body per status (Rules M15, G8).
 */
export class LogAccessDeniedError extends Error {
  public constructor(
    public readonly status: 401 | 403,
    public readonly reason: LogAccessDenialReason,
  ) {
    super(reason);
  }
}
