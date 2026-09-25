/**
 * Where the work being logged came from. `api` is an inbound HTTP request;
 * `job:<queue>` is a background job, named per queue so one noisy queue can be
 * picked out without the value being unbounded.
 */
export type RequestContextSource = 'api' | `job:${string}`;

/**
 * Per-request correlation data carried through an `AsyncLocalStorage` store
 * for the lifetime of a single request. Single source of truth for the
 * logger and adapter instrumentation to attach correlation identifiers
 * without threading them through every function signature.
 */
export interface RequestContextStore {
  // Absent for work nobody requested — scheduled and startup jobs — so that
  // those lines carry no correlation id rather than an invented one.
  requestId?: string;
  // Set by whoever opens the context, because only they know what kind of
  // work it is. A worker restores a request's identifiers but is not the API.
  source: RequestContextSource;
  tenantId?: string;
  // Only set for routes that address a specific operation, so it is absent on
  // most lines rather than empty.
  operationId?: string;
}
