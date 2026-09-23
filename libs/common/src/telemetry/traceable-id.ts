/**
 * Tenant and operation identifiers are UUIDs throughout the service. Values
 * reaching a span attribute are not always trustworthy: interceptors run before
 * pipes, so an HTTP request carries raw URL input, and job payloads are read as
 * untyped records. Checking the shape first keeps malformed or oversized values
 * out of the tracing backend, where attributes are indexed for search.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTraceableId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
