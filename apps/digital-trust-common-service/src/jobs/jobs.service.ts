import type { RequestContextStore } from '@app/common/context/request-context.interface';
import { RequestContextService } from '@app/common/context/request-context.service';
import { isTraceableId } from '@app/common/telemetry/traceable-id';
import { PgBossService } from '@app/pg-boss';
import { QUEUE_DEFINITIONS, fromTypeOrm } from '@app/pg-boss';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  context as otelContext,
  propagation,
  trace,
} from '@opentelemetry/api';
import {
  ATTR_MESSAGING_DESTINATION_NAME,
  ATTR_MESSAGING_MESSAGE_ID,
  ATTR_MESSAGING_OPERATION_NAME,
  ATTR_MESSAGING_SYSTEM,
} from '@opentelemetry/semantic-conventions/incubating';
import type { Job, WorkHandler, WorkOptions } from 'pg-boss';
import type { EntityManager } from 'typeorm';

import {
  ShutdownRegistry,
  ShutdownParticipant,
} from '../shutdown/shutdown-registry';

export type RegisterWorkerOptions = WorkOptions & {
  /** When false, skip attaching a worker (API-only pods). Default true. */
  enabled?: boolean;
};

const JOB_TRACER_NAME = 'digital-trust-common-service/jobs';

const OPERATION_ID_ATTRIBUTE = 'operation.id';
const TENANT_ID_ATTRIBUTE = 'tenant.id';

// W3C trace context, carried on the job payload so the worker can continue the
// trace of the request that enqueued the job rather than starting its own.
const TRACE_CARRIER_KEYS = ['traceparent', 'tracestate'] as const;

@Injectable()
export class JobsService implements ShutdownParticipant, OnModuleInit {
  private readonly logger = new Logger(JobsService.name);
  public readonly name = 'JobsService';
  public readonly order = 1;

  private queuesReady = false;
  private ensureQueuesPromise: Promise<void> | null = null;

  public constructor(
    private readonly bossService: PgBossService,
    private readonly shutdownRegistry: ShutdownRegistry,
    private readonly config: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly requestContext: RequestContextService,
  ) {}

  public async onModuleInit(): Promise<void> {
    this.shutdownRegistry.register(this);
    await this.ensureQueues();
    this.eventEmitter.emit('jobs.queues.ready');
  }

  public async ensureQueues(): Promise<void> {
    if (this.queuesReady) {
      return;
    }

    if (!this.ensureQueuesPromise) {
      this.ensureQueuesPromise = this.createQueuesOnce().catch((err) => {
        this.ensureQueuesPromise = null;
        throw err;
      });
    }

    await this.ensureQueuesPromise;
  }

  private async createQueuesOnce(): Promise<void> {
    for (const definition of QUEUE_DEFINITIONS) {
      await this.bossService.boss.createQueue(definition.deadLetter);
      await this.bossService.boss.createQueue(definition.name, {
        retryLimit: definition.retryLimit,
        retryDelay: definition.retryDelay,
        retryBackoff: definition.retryBackoff,
        deadLetter: definition.deadLetter,
      });
      this.logger.log(`Ensured queue ${definition.name}`);
    }

    this.queuesReady = true;
  }

  public publish(name: string, data: object | null): Promise<string | null> {
    return this.bossService.boss.send(name, this.withRequestContext(data));
  }

  /**
   * Ensure a recurring pg-boss cron schedule for a queue (idempotent upsert).
   */
  public async schedule(
    name: string,
    cron: string,
    data: object | null = null,
  ): Promise<void> {
    await this.ensureQueues();
    await this.bossService.boss.schedule(name, cron, data);
    this.logger.log(`Scheduled ${name} with cron '${cron}'`);
  }

  /**
   * Enqueue a job using the same DB transaction as the caller's EntityManager.
   */
  public async sendInTransaction(
    manager: EntityManager,
    queueName: string,
    data: object | null,
  ): Promise<string | null> {
    return this.bossService.boss.send(
      queueName,
      this.withRequestContext(data),
      {
        db: fromTypeOrm(manager),
      },
    );
  }

  /**
   * Merges the active request's correlation identifiers and trace context into
   * outgoing job data, so a worker processing this job later can log/trace it
   * against the request that enqueued it. Jobs enqueued outside a
   * request (cron schedules, startup tasks) have no active context, so
   * `data` passes through unchanged.
   *
   * Never overwrites a `requestId`/`tenantId` the caller already set —
   * several job data shapes (e.g. `AuditWriteJobData`,
   * `TenantStatusChangeJobData`) carry a domain `tenantId` that identifies
   * the tenant the job is about, which is not necessarily the same tenant
   * as the request's correlation context (e.g. a platform-admin action).
   * Clobbering it here would misattribute the job.
   *
   * The request's `operationId` is deliberately not carried. It is optional on
   * `AuditWriteJobData`, where it is persisted as the operation the audit
   * record is about, so a producer leaving it unset means "not about an
   * operation". Since only a key the caller actually set survives the merge
   * below, injecting it would win in exactly that case and write a wrong
   * operation onto the record. A worker still logs `operation_id` when the
   * payload itself carries one.
   *
   * The trace context is the one exception to caller-wins: it carries no
   * domain meaning, so the context active at enqueue time is authoritative.
   * A `traceparent`/`tracestate` already on the data is replaced, and dropped
   * outright when nothing is active, so a job can never inherit a stale trace
   * and be attached to an unrelated request.
   */
  private withRequestContext(data: object | null): object | null {
    const context = this.requestContext.get();
    const injected: Record<string, string> = {};

    // Injects nothing when no SDK is registered or no span is active, which is
    // why the trace context is read separately from the request context: work
    // can be traced without having arrived over HTTP.
    propagation.inject(otelContext.active(), injected);

    // The configured propagators can write more than the trace context — the
    // default set also emits `baggage`, which carries whatever an inbound
    // request sent. Job data is persisted, so only the keys a worker reads
    // back are carried forward.
    const carrier = this.traceCarrierFrom(injected);
    const base = (data ?? {}) as Record<string, unknown>;
    const stale = TRACE_CARRIER_KEYS.some((key) => key in base);

    if (!context && !stale && Object.keys(carrier).length === 0) {
      return data;
    }

    const domain = { ...base };
    for (const key of TRACE_CARRIER_KEYS) {
      delete domain[key];
    }

    return {
      ...(context?.tenantId ? { tenantId: context.tenantId } : {}),
      ...(context?.requestId ? { requestId: context.requestId } : {}),
      ...domain,
      ...carrier,
    };
  }

  public defaultWorkOptions(): WorkOptions {
    const nodeEnv = this.config.get<string>('NODE_ENV', 'development');
    const pollingDefault = nodeEnv === 'production' ? 1 : 2;
    const pollingIntervalSeconds = Number(
      this.config.get<string>(
        'PG_BOSS_POLLING_INTERVAL_SECONDS',
        String(pollingDefault),
      ),
    );
    const localConcurrency = Number(
      this.config.get<string>('PG_BOSS_LOCAL_CONCURRENCY', '2'),
    );

    return {
      pollingIntervalSeconds,
      localConcurrency,
      batchSize: 1,
    };
  }

  /**
   * Register a pg-boss worker for a queue. Domain modules call this from
   * OnModuleInit after queues are ensured.
   */
  public async registerWorker<T extends object>(
    queueName: string,
    handler: (job: Job<T>) => Promise<void>,
    options: RegisterWorkerOptions = {},
  ): Promise<string | null> {
    const { enabled = true, ...workOptions } = options;
    if (!enabled) {
      this.logger.log(`Skipping worker registration for ${queueName}`);
      return null;
    }

    await this.ensureQueues();

    const merged: WorkOptions = {
      ...this.defaultWorkOptions(),
      ...workOptions,
    };

    const workHandler: WorkHandler<T> = async (jobs) => {
      for (const job of jobs) {
        await this.runJob(queueName, job, handler);
      }
    };

    const workerId = await this.bossService.boss.work(
      queueName,
      merged,
      workHandler,
    );
    this.logger.log(`Registered worker for ${queueName} (${workerId})`);
    return workerId;
  }

  /**
   * Runs one job inside a span and a restored request context, so every line
   * the handler logs can be traced back to whatever enqueued it.
   *
   * Both scopes close before the next job in the batch starts, which is what
   * stops one job's identifiers being attributed to the next.
   */
  private async runJob<T extends object>(
    queueName: string,
    job: Job<T>,
    handler: (job: Job<T>) => Promise<void>,
  ): Promise<void> {
    const data = (job.data ?? {}) as Record<string, unknown>;
    const carrier = this.traceCarrierFrom(data);

    // Parented from the root rather than from whatever happens to be active:
    // this callback runs inside pg-boss's polling loop, so an instrumented
    // database query can leave a span in scope. Extracting from the active
    // context would quietly hang the job off that query, or off the previous
    // job, instead of continuing the enqueuing request or starting fresh.
    const parent =
      Object.keys(carrier).length > 0
        ? propagation.extract(ROOT_CONTEXT, carrier)
        : ROOT_CONTEXT;
    const jobContext = this.jobContextFrom(queueName, data);
    const startedAt = Date.now();

    await trace.getTracer(JOB_TRACER_NAME).startActiveSpan(
      `${queueName} process`,
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          [ATTR_MESSAGING_SYSTEM]: 'pg-boss',
          [ATTR_MESSAGING_DESTINATION_NAME]: queueName,
          [ATTR_MESSAGING_MESSAGE_ID]: job.id,
          [ATTR_MESSAGING_OPERATION_NAME]: 'process',
          // Which tenant and operation the job belongs to, so a trace search
          // can narrow to one tenant's work without reading every span.
          ...(isTraceableId(jobContext.tenantId)
            ? { [TENANT_ID_ATTRIBUTE]: jobContext.tenantId }
            : {}),
          ...(isTraceableId(jobContext.operationId)
            ? { [OPERATION_ID_ATTRIBUTE]: jobContext.operationId }
            : {}),
        },
      },
      parent,
      async (span) =>
        // The log lines below sit inside this scope so they carry the same
        // correlation fields the handler's own lines do.
        this.requestContext.run(jobContext, async () => {
          try {
            await handler(job);

            this.logger.log(
              {
                duration_ms: Date.now() - startedAt,
                job_id: job.id,
                queue: queueName,
              },
              'job completed',
            );
          } catch (error) {
            span.setStatus({ code: SpanStatusCode.ERROR });
            if (error instanceof Error) {
              span.recordException(error);
            }

            this.logger.error(
              {
                duration_ms: Date.now() - startedAt,
                err: error,
                job_id: job.id,
                queue: queueName,
              },
              'job failed',
            );

            // Rethrown so pg-boss still applies its retry policy.
            throw error;
          } finally {
            span.end();
          }
        }),
    );
  }

  /**
   * Identifiers the enqueuing request left on the payload. A job nobody
   * requested carries none, and gets a context with only its source so its
   * lines are attributable to a queue without inventing a request id.
   */
  private jobContextFrom(
    queueName: string,
    data: Record<string, unknown>,
  ): RequestContextStore {
    const requestId = data.requestId;
    const tenantId = data.tenantId;
    const operationId = data.operationId;

    return {
      source: `job:${queueName}`,
      ...(typeof requestId === 'string' ? { requestId } : {}),
      ...(typeof tenantId === 'string' ? { tenantId } : {}),
      ...(typeof operationId === 'string' ? { operationId } : {}),
    };
  }

  private traceCarrierFrom(
    data: Record<string, unknown>,
  ): Record<string, string> {
    const carrier: Record<string, string> = {};

    for (const key of TRACE_CARRIER_KEYS) {
      const value = data[key];
      if (typeof value === 'string') {
        carrier[key] = value;
      }
    }

    return carrier;
  }

  public async shutdown(): Promise<void> {
    this.logger.log('Stopping jobs service...');
    await this.bossService.stop();
    this.logger.log('Jobs service stopped');
  }
}
