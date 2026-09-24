import { AdapterError, AgentAdapter } from '@app/credential-ports';

import {
  ADAPTER_OUTCOME_SUCCESS,
  ADAPTER_OUTCOME_UNKNOWN,
  BusinessMetricsService,
} from '../common/telemetry/business-metrics.service';

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
const PORT_METHODS_COVER_EVERY_PORT_METHOD = true as CoverageComplete;
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
 * Returns the adapter wrapped so every port method call is counted by
 * connector, method, and outcome.
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
        // `target` rather than `this`: the bound receiver is the proxy, and
        // calling through it would re-enter this trap for any port method the
        // adapter calls on itself, counting one caller-visible call twice.
        let result: unknown;

        try {
          result = method.apply(target, args);
        } catch (error) {
          metrics.recordAdapterCall(
            connectorType,
            property,
            classifyAdapterOutcome(error),
          );

          throw error;
        }

        // Port methods return promises, but a test double or a future
        // synchronous implementation need not, and awaiting a non-promise here
        // would turn a synchronous call asynchronous for its caller.
        if (!isPromiseLike(result)) {
          metrics.recordAdapterCall(
            connectorType,
            property,
            ADAPTER_OUTCOME_SUCCESS,
          );

          return result;
        }

        return result.then(
          (resolved) => {
            metrics.recordAdapterCall(
              connectorType,
              property,
              ADAPTER_OUTCOME_SUCCESS,
            );

            return resolved;
          },
          (error: unknown) => {
            metrics.recordAdapterCall(
              connectorType,
              property,
              classifyAdapterOutcome(error),
            );

            throw error;
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
