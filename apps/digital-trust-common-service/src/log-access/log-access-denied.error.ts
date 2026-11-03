export type LogAccessDenialReason =
  | 'audience_not_configured'
  | 'invalid_token'
  | 'missing_required_claims'
  | 'invalid_tenant_id'
  | 'missing_logs_read_scope'
  | 'resolution_failed'
  | 'partition_bound_exceeded'
  | 'rate_limited';

/**
 * Carries the operator-facing reason for a denial. The reason is for logs
 * only; the caller sees one fixed body per status.
 */
export type LogAccessStatus = 401 | 403 | 429;

export class LogAccessDeniedError extends Error {
  public constructor(
    public readonly status: LogAccessStatus,
    public readonly reason: LogAccessDenialReason,
  ) {
    super(reason);
  }
}
