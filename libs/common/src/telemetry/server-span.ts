import type { Span } from '@opentelemetry/api';

/**
 * Key under which the HTTP server span is stashed on the incoming request.
 *
 * `instrumentation-http` opens the server span before Nest sees the request.
 * By the time a Nest interceptor runs, several express and nestjs-core spans
 * are nested inside it, so `trace.getActiveSpan()` returns a handler span, not
 * the span representing the request as a whole. Keeping a reference lets
 * request-scoped attributes land on the server span, where trace search and
 * root-span-oriented dashboards look for them.
 *
 * `Symbol.for` rather than `Symbol()` so a duplicate module instance (src and
 * dist both loaded, for example) still resolves to the same key.
 */
const SERVER_SPAN = Symbol.for('digital-trust.telemetry.server-span');

type ServerSpanCarrier = { [SERVER_SPAN]?: Span };

/** Records the server span on the request that opened it. */
export function rememberServerSpan(carrier: object, span: Span): void {
  (carrier as ServerSpanCarrier)[SERVER_SPAN] = span;
}

/** Returns the server span recorded for a request, if telemetry is running. */
export function getServerSpan(carrier: unknown): Span | undefined {
  if (typeof carrier !== 'object' || carrier === null) {
    return undefined;
  }

  return (carrier as ServerSpanCarrier)[SERVER_SPAN];
}
