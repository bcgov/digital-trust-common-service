/**
 * Per-request correlation data carried through an `AsyncLocalStorage` store
 * for the lifetime of a single request. Single source of truth for the
 * logger and adapter instrumentation to attach correlation identifiers
 * without threading them through every function signature.
 */
export interface RequestContextStore {
  requestId: string;
  tenantId?: string;
  // Only set for routes that address a specific operation, so it is absent on
  // most lines rather than empty.
  operationId?: string;
}
