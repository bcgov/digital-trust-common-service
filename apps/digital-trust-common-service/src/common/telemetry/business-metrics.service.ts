import { Injectable, Logger } from '@nestjs/common';
import { Counter, Meter, metrics } from '@opentelemetry/api';
import type { EntityManager, QueryRunner } from 'typeorm';

/**
 * The counters that measure the work this service exists to do, as opposed to
 * the auto-instrumented HTTP, database, and runtime metrics that measure the
 * plumbing around it. See `docs/observability-metrics.md` for why these exist
 * and what question each one answers.
 *
 * They live in the application rather than `@app/common/telemetry` because
 * their bounded dimension values come from application domain sets
 * (`OPERATION_TYPE`, `ConnectorType`, the adapter port methods); the library
 * side owns SDK bootstrap and span plumbing, which knows about none of them.
 *
 * Two rules from that document are enforced here rather than left to review:
 *
 *  - No dimension may carry tenant identity. Nothing on this class accepts a
 *    tenant id, so no call site is able to supply one.
 *  - Every dimension value must come from a small fixed set. Callers normalise
 *    against their own enum first; `boundedLabel` is the backstop for values
 *    typed as plain strings, where one malformed record would otherwise create
 *    a permanent series.
 */

/** Instrument names, dotted per OTel semantic conventions. */
export const CREDENTIAL_OPERATIONS_METRIC = 'credential.operations';
export const ADAPTER_CALLS_METRIC = 'adapter.calls';

/** Attribute (dimension) names carried by those instruments. */
export const ATTR_OPERATION_TYPE = 'operation.type';
export const ATTR_OPERATION_OUTCOME = 'operation.outcome';
export const ATTR_CONNECTOR_TYPE = 'connector.type';
export const ATTR_ADAPTER_METHOD = 'adapter.method';
export const ATTR_ADAPTER_OUTCOME = 'adapter.outcome';

/**
 * Substituted for any dimension value that fails the shape check below. A
 * single shared bucket is deliberate: the alternatives are dropping the
 * measurement, which under-reports, or passing the value through, which lets
 * unbounded input become permanent series.
 */
export const UNCLASSIFIED_LABEL = 'unclassified';

/** Recorded when an adapter port method returns rather than throws. */
export const ADAPTER_OUTCOME_SUCCESS = 'success';

/** Recorded when an adapter port method throws something that is not an AdapterError. */
export const ADAPTER_OUTCOME_UNKNOWN = 'unknown';

/**
 * Terminal operation states. Non-terminal transitions are not counted: an
 * operation moving pending -> processing has not produced an outcome yet, and
 * counting it would make the total disagree with the number of operations.
 */
export type OperationOutcome = 'completed' | 'failed';

/**
 * The shape a dimension value must have to be recorded as-is: short, and drawn
 * from the character set this codebase's own identifiers and error codes use.
 * This bounds the damage from a value typed as a string rather than an enum. It
 * does not bound the number of distinct legitimate values, which is bounded by
 * the source sets themselves.
 */
const SAFE_LABEL_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;

/**
 * Rejected ahead of the shape check above, which would otherwise accept any
 * UUID beginning with a-f: `-` is a legal character and 36 is under the length
 * cap. Identifiers in this service are UUIDs — tenant ids among them — so this
 * is the specific unbounded shape the backstop exists to stop.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const METER_NAME = 'digital-trust-common-service';

/** Key under which pending records wait on the transaction's query runner. */
const DEFERRED_KEY = 'digitalTrust.businessMetrics.deferred';

/** Key under which each open nesting level's start offset is stacked. */
const MARKS_KEY = 'digitalTrust.businessMetrics.deferredMarks';

interface DeferredCredentialOperation {
  readonly operationType: string;
  readonly outcome: OperationOutcome;
}

/** Returns the value when it is safe to use as a dimension, else a fixed bucket. */
export function boundedLabel(value: string): string {
  if (UUID_PATTERN.test(value)) {
    return UNCLASSIFIED_LABEL;
  }

  return SAFE_LABEL_PATTERN.test(value) ? value : UNCLASSIFIED_LABEL;
}

@Injectable()
export class BusinessMetricsService {
  private readonly logger = new Logger(BusinessMetricsService.name);

  private credentialOperations?: Counter;

  private adapterCalls?: Counter;

  /**
   * Counts one credential operation reaching a terminal state.
   *
   * Answers "is the product working right now": a sustained rise in the
   * `failed` outcome for a type is the signal that starts an investigation,
   * which then moves to logs and traces to establish whose and why.
   *
   * `operationType` is a string rather than a union because `Operation.type` is
   * a varchar the API contract deliberately keeps open — the caller normalises
   * it against `OPERATION_TYPE` before calling.
   *
   * When `manager` belongs to an open transaction the record is held until that
   * transaction commits. The transition it describes is not a fact until then,
   * and the enclosing transaction routinely does further work that can roll the
   * whole thing back — after which a worker retry replays the same transition.
   * Recording eagerly would count those replays as separate operations.
   */
  public recordCredentialOperation(
    operationType: string,
    outcome: OperationOutcome,
    manager?: EntityManager,
  ): void {
    const queryRunner = manager?.queryRunner;

    if (queryRunner?.isTransactionActive === true) {
      this.defer(queryRunner, { operationType, outcome });
      return;
    }

    this.emitCredentialOperation({ operationType, outcome });
  }

  /**
   * Counts one port method call against an agent adapter.
   *
   * Answers "is the agent behind this connector healthy, and how is it
   * failing": the error class separates a connector that is down from one
   * rejecting the payloads being sent to it, and those lead to different
   * actions. `outcome` is `success` or the adapter error's stable `code`.
   */
  public recordAdapterCall(
    connectorType: string,
    method: string,
    outcome: string,
  ): void {
    // Telemetry must never change the outcome of the work it observes. The
    // adapter proxy records on both the success and the error path, so a throw
    // here would either lose an AdapterError subclass that callers map to an
    // HTTP status, or turn a successful call into a failed one.
    try {
      this.getAdapterCalls().add(1, {
        [ATTR_CONNECTOR_TYPE]: boundedLabel(connectorType),
        [ATTR_ADAPTER_METHOD]: boundedLabel(method),
        [ATTR_ADAPTER_OUTCOME]: boundedLabel(outcome),
      });
    } catch (error) {
      this.logger.warn(
        `Failed to record ${ADAPTER_CALLS_METRIC}: ${String(error)}`,
      );
    }
  }

  /**
   * Opens a nesting level. Called from TypeORM's after-start broadcast, which
   * fires for a `SAVEPOINT` as well as for the outermost `START TRANSACTION`.
   * The mark is where this level's records begin, so an inner rollback can
   * drop exactly its own without touching the enclosing transaction's.
   */
  public beginDeferredScope(queryRunner: QueryRunner): void {
    this.marks(queryRunner).push(this.queue(queryRunner).length);
  }

  /**
   * Emits the records held for a transaction that committed. Called by
   * {@link TransactionalMetricsSubscriber} from TypeORM's after-commit
   * broadcast, which fires both when `COMMIT` has returned and when a nested
   * level merely released its savepoint. Only the former makes the records
   * durable, and TypeORM distinguishes them by clearing `isTransactionActive`
   * on the real commit alone — a nested release leaves the records queued for
   * the enclosing transaction to settle.
   */
  public flushDeferred(queryRunner: QueryRunner): void {
    this.marks(queryRunner).pop();

    if (queryRunner.isTransactionActive) {
      return;
    }

    const pendingRecords = this.takeDeferred(queryRunner);

    for (const pending of pendingRecords) {
      this.emitCredentialOperation(pending);
    }
  }

  /**
   * Drops the records held for a transaction that rolled back. A nested level
   * rolls back to its savepoint, undoing only the writes made inside it, so
   * only the records made inside it are dropped.
   */
  public discardDeferred(queryRunner: QueryRunner): void {
    const mark = this.marks(queryRunner).pop();

    if (queryRunner.isTransactionActive) {
      this.queue(queryRunner).length = mark ?? 0;
      return;
    }

    this.takeDeferred(queryRunner);
  }

  private defer(
    queryRunner: QueryRunner,
    pending: DeferredCredentialOperation,
  ): void {
    this.queue(queryRunner).push(pending);
  }

  private queue(queryRunner: QueryRunner): DeferredCredentialOperation[] {
    const existing = queryRunner.data[DEFERRED_KEY] as
      DeferredCredentialOperation[] | undefined;

    if (existing !== undefined) {
      return existing;
    }

    const created: DeferredCredentialOperation[] = [];
    queryRunner.data[DEFERRED_KEY] = created;

    return created;
  }

  private marks(queryRunner: QueryRunner): number[] {
    const existing = queryRunner.data[MARKS_KEY] as number[] | undefined;

    if (existing !== undefined) {
      return existing;
    }

    const created: number[] = [];
    queryRunner.data[MARKS_KEY] = created;

    return created;
  }

  private takeDeferred(
    queryRunner: QueryRunner,
  ): readonly DeferredCredentialOperation[] {
    const queue = queryRunner.data[DEFERRED_KEY] as
      DeferredCredentialOperation[] | undefined;

    delete queryRunner.data[DEFERRED_KEY];
    delete queryRunner.data[MARKS_KEY];

    return queue ?? [];
  }

  private emitCredentialOperation(pending: DeferredCredentialOperation): void {
    // See recordAdapterCall: a metrics failure must not surface to the caller,
    // and on the deferred path it would surface inside TypeORM's commit
    // broadcast, failing a transaction that has already committed.
    try {
      this.getCredentialOperations().add(1, {
        [ATTR_OPERATION_TYPE]: boundedLabel(pending.operationType),
        [ATTR_OPERATION_OUTCOME]: pending.outcome,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to record ${CREDENTIAL_OPERATIONS_METRIC}: ${String(error)}`,
      );
    }
  }

  /**
   * Counters are created on first use rather than in the constructor. The
   * metrics API has no proxy provider — unlike traces — so a counter obtained
   * before `tracing.ts` registers the SDK binds to the no-op provider for the
   * life of the process and silently records nothing. Nest instantiates
   * providers well after that import runs, but resolving lazily keeps this
   * correct regardless of instantiation order, and is what lets the class stay
   * callable when `OTEL_ENABLED` is unset: every add lands on the no-op meter.
   */
  private getCredentialOperations(): Counter {
    this.credentialOperations ??= this.meter().createCounter(
      CREDENTIAL_OPERATIONS_METRIC,
      {
        description:
          'Credential operations that reached a terminal state, by type and outcome.',
        unit: '{operation}',
      },
    );

    return this.credentialOperations;
  }

  private getAdapterCalls(): Counter {
    this.adapterCalls ??= this.meter().createCounter(ADAPTER_CALLS_METRIC, {
      description:
        'Agent adapter port method calls, by connector, method, and outcome or error class.',
      unit: '{call}',
    });

    return this.adapterCalls;
  }

  private meter(): Meter {
    return metrics.getMeter(METER_NAME);
  }
}
