import { AdapterError, AgentAdapter } from '@app/credential-ports';
import { Logger } from '@nestjs/common';
import { Span, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';

import {
  ADAPTER_OUTCOME_SUCCESS,
  ADAPTER_OUTCOME_UNKNOWN,
  ATTR_ADAPTER_METHOD,
  ATTR_ADAPTER_OUTCOME,
  ATTR_CONNECTOR_TYPE,
  BusinessMetricsService,
} from '../common/telemetry/business-metrics.service';

const ADAPTER_TRACER_NAME = 'digital-trust-common-service/adapter';

/**
 * Module-level rather than injected: the wrapper is a plain function, and
 * threading a logger through `instrumentAdapter` would change every call site
 * and every test double for a value that is the same everywhere.
 *
 * The correlation fields — `request_id`, `tenant_id`, `operation_id`,
 * `trace_id` — are attached by the pino mixin and the pino instrumentation, so
 * nothing is threaded through here for them either.
 */
const logger = new Logger('AdapterCall');

/**
 * The port methods an AgentAdapter exposes, keyed by the port that declares
 * them, and the only property names this wrapper intercepts. Method names are a
 * metric dimension, so the set has to be fixed in code rather than discovered
 * from whatever a caller asks for.
 */
const PORT_METHODS_BY_PORT = {
  issuer: ['offerCredential', 'getExchange'],
  verifier: ['requestPresentation', 'getPresentation'],
  holder: ['acceptOffer', 'rejectOffer'],
  connection: ['createInvitation', 'acceptInvitation', 'list', 'getById'],
  revocation: ['revoke', 'batchRevoke'],
} as const;

const PORT_METHODS = Object.values(PORT_METHODS_BY_PORT).flat();

type ListedMethod = (typeof PORT_METHODS)[number];

/** Every asynchronous method on the AgentAdapter surface. */
type PortMethod = {
  [K in keyof AgentAdapter]: AgentAdapter[K] extends (
    ...args: never[]
  ) => Promise<unknown>
    ? K
    : never;
}[keyof AgentAdapter];

/**
 * Enforces `docs/observability-metrics.md`'s coverage rule at compile time
 * rather than at review. Adding a method to any port interface without adding
 * it to the map above fails the build here, because a counter that silently
 * ignores a new method still looks authoritative while under-reporting — which
 * is worse than having no counter at all. The reverse assignment catches a
 * listed name that no longer exists on the surface.
 */
type UncoveredMethod = Exclude<PortMethod, ListedMethod>;
type CoverageComplete = [UncoveredMethod] extends [never] ? true : never;
const PORT_METHODS_COVER_EVERY_PORT_METHOD: CoverageComplete = true;
void PORT_METHODS_COVER_EVERY_PORT_METHOD;
const LISTED_METHODS_EXIST: readonly PortMethod[] = PORT_METHODS;
void LISTED_METHODS_EXIST;

const PORT_METHOD_NAMES = new Set<string>(PORT_METHODS);

/**
 * Key under which the wrapper exposes the adapter it wraps.
 *
 * A proxy is deliberately indistinguishable from its target, which also means
 * `resolve().adapter === theRegisteredAdapter` stops holding once the registry
 * instruments what it hands out. Rather than weaken those checks to comparing
 * connector types, the wrapper answers "which adapter is this really" directly.
 *
 * `Symbol.for` rather than `Symbol()` so a duplicate module instance (src and
 * dist both loaded, for example) still resolves to the same key.
 */
const INSTRUMENTED_TARGET = Symbol.for(
  'digital-trust.telemetry.instrumented-adapter',
);

/**
 * Returns the adapter an instrumented wrapper wraps, or the argument unchanged
 * when it is not wrapped. Unwrapping repeatedly is safe.
 */
export function unwrapAdapter(adapter: AgentAdapter): AgentAdapter {
  const target = (adapter as { [INSTRUMENTED_TARGET]?: AgentAdapter })[
    INSTRUMENTED_TARGET
  ];

  return target ?? adapter;
}

/**
 * Classifies a thrown value into the bounded outcome label the adapter call
 * counter records.
 *
 * `AdapterError.code` is the stable machine-readable discriminator each error
 * class already declares, so the label set grows only when an error class is
 * added — never with traffic. Anything else is an unexpected failure: it is
 * counted, so the total still matches the number of calls, but under one shared
 * bucket rather than a label derived from an arbitrary error.
 */
export function classifyAdapterOutcome(error: unknown): string {
  return error instanceof AdapterError ? error.code : ADAPTER_OUTCOME_UNKNOWN;
}

/**
 * Returns the adapter wrapped so every port method call is counted and traced
 * by connector, method, and outcome.
 *
 * A proxy rather than a decorator on each adapter: instrumentation then applies
 * to any adapter the registry is given, including ones added later and the test
 * doubles, and no adapter implementation has to know that metrics exist. Errors
 * are counted and rethrown unchanged — observation must not alter behaviour,
 * and callers depend on the specific AdapterError class to map to an HTTP
 * response.
 *
 * Only the listed port methods are intercepted. `connectorType`,
 * `supportedFormats`, and anything else pass through untouched, so the proxy
 * still satisfies the capability checks `AdapterRegistry.register` makes.
 */
export function instrumentAdapter(
  adapter: AgentAdapter,
  metrics: BusinessMetricsService,
): AgentAdapter {
  const connectorType: string = adapter.connectorType;

  return new Proxy(adapter, {
    get(target, property, receiver): unknown {
      if (property === INSTRUMENTED_TARGET) {
        return target;
      }

      const value: unknown = Reflect.get(target, property, receiver);

      if (
        typeof property !== 'string' ||
        typeof value !== 'function' ||
        !PORT_METHOD_NAMES.has(property)
      ) {
        return value;
      }

      const method = value as (...args: unknown[]) => unknown;

      return function instrumented(this: unknown, ...args: unknown[]): unknown {
        // Active rather than detached, so the HTTP client span the OTel
        // auto-instrumentation records for the agent request nests inside this
        // one. That nesting is the point: the adapter span on its own gives a
        // duration, and the child gives how much of it was spent on the wire
        // versus in this service. Anything else the adapter does — a database
        // query, another HTTP call — nests for the same reason.
        //
        // startActiveSpan returns whatever the callback returns, so the three
        // settle paths below stay exactly as they were.
        return trace.getTracer(ADAPTER_TRACER_NAME).startActiveSpan(
          `${connectorType} ${property}`,
          {
            kind: SpanKind.CLIENT,
            attributes: {
              [ATTR_CONNECTOR_TYPE]: connectorType,
              [ATTR_ADAPTER_METHOD]: property,
            },
          },
          (span): unknown => {
            const startedAt = Date.now();
            let result: unknown;

            // `target` rather than `this`: the bound receiver is the proxy, and
            // calling through it would re-enter this trap for any port method
            // the adapter calls on itself, counting one caller-visible call
            // twice.
            try {
              result = method.apply(target, args);
            } catch (error) {
              settleFailure(
                span,
                metrics,
                connectorType,
                property,
                startedAt,
                error,
              );

              throw error;
            }

            // Port methods return promises, but a test double or a future
            // synchronous implementation need not, and awaiting a non-promise
            // here would turn a synchronous call asynchronous for its caller.
            if (!isPromiseLike(result)) {
              settleSuccess(span, metrics, connectorType, property, startedAt);

              return result;
            }

            return result.then(
              (resolved) => {
                settleSuccess(
                  span,
                  metrics,
                  connectorType,
                  property,
                  startedAt,
                );

                return resolved;
              },
              (error: unknown) => {
                settleFailure(
                  span,
                  metrics,
                  connectorType,
                  property,
                  startedAt,
                  error,
                );

                throw error;
              },
            );
          },
        );
      };
    },
  });
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  );
}

/**
 * Closes out a call that returned.
 *
 * `adapter.outcome` is set here rather than at span start because it is not
 * known until the call settles, and the span, the counter, and the log line all
 * take the same value from the same place so a trace, a dashboard, and a log
 * search cannot disagree.
 *
 * Span attribute values are deliberately not put through `boundedLabel`. That
 * backstop exists to stop an unexpected string becoming a permanent metric
 * series; spans are not aggregated into series, and reusing it here would
 * discard detail from a trace to solve a problem traces do not have.
 */
function settleSuccess(
  span: Span,
  metrics: BusinessMetricsService,
  connectorType: string,
  method: string,
  startedAt: number,
): void {
  span.setAttribute(ATTR_ADAPTER_OUTCOME, ADAPTER_OUTCOME_SUCCESS);
  span.end();

  metrics.recordAdapterCall(connectorType, method, ADAPTER_OUTCOME_SUCCESS);

  logger.log(
    {
      connector: connectorType,
      duration_ms: Date.now() - startedAt,
      method,
      outcome: ADAPTER_OUTCOME_SUCCESS,
    },
    'adapter call completed',
  );
}

/**
 * Closes out a call that threw. The error is recorded, never handled: the
 * caller is rethrown the original value so the AdapterError subclass it maps to
 * an HTTP status survives.
 *
 * The error is reduced to an explicit set of fields rather than logged under
 * `err`. pino treats any value with a string `message` as an error and copies
 * every own enumerable property off it, so passing the error through would emit
 * `AdapterError.context` in full — and with it `FormatValidationError.issues`,
 * whose `actual` field holds the credential attribute value that failed
 * validation. An allowlist makes that structural instead of leaving it to
 * redaction to guess the key names a future adapter picks.
 */
function settleFailure(
  span: Span,
  metrics: BusinessMetricsService,
  connectorType: string,
  method: string,
  startedAt: number,
  error: unknown,
): void {
  const outcome = classifyAdapterOutcome(error);

  span.setAttribute(ATTR_ADAPTER_OUTCOME, outcome);
  span.setStatus({ code: SpanStatusCode.ERROR });

  // recordException takes an Error or an exception-shaped object; a thrown
  // primitive is left to the status and the outcome attribute.
  if (error instanceof Error) {
    span.recordException(error);
  }

  span.end();

  metrics.recordAdapterCall(connectorType, method, outcome);

  logger.error(
    {
      connector: connectorType,
      duration_ms: Date.now() - startedAt,
      ...describeError(error),
      method,
      outcome,
    },
    'adapter call failed',
  );
}

/** The fields of a thrown value this wrapper is willing to log. */
interface DescribedError {
  error_message: string;
  error_stack?: string;
  error_type: string;
}

/**
 * Describes a thrown value without reaching into it. A thrown non-Error is
 * stringified rather than inspected, so an object carrying arbitrary fields
 * cannot smuggle them into the log either.
 */
function describeError(error: unknown): DescribedError {
  if (error instanceof Error) {
    return {
      error_message: error.message,
      error_stack: error.stack,
      error_type: error.name,
    };
  }

  return { error_message: String(error), error_type: typeof error };
}
