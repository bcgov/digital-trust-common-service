import { PG_BOSS } from '@app/pg-boss';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  Optional,
} from '@nestjs/common';
import {
  type BatchObservableResult,
  type Meter,
  type ObservableGauge,
  metrics,
} from '@opentelemetry/api';

import { ATTR_QUEUE_NAME, boundedLabel } from './business-metrics.service';

/** Instrument names, dotted per OTel semantic conventions. */
export const QUEUE_WAITING_METRIC = 'jobs.queue.waiting';
export const QUEUE_RUNNING_METRIC = 'jobs.queue.running';
export const QUEUE_DEAD_LETTERED_METRIC = 'jobs.queue.dead_lettered';

const METER_NAME = 'digital-trust-common-service';

/** pg-boss's own housekeeping queues, not work this service enqueues. */
const INTERNAL_QUEUE_PREFIX = '__pgboss__';

/**
 * The slice of pg-boss this class reads. pg-boss is ESM-only and cannot be
 * imported under the unit jest config, so depending on this shape instead of
 * the `PgBoss` class lets the readings be tested with a plain object.
 */
export interface QueueCounts {
  readonly name: string;
  readonly deadLetter?: string;
  readonly readyCount: number;
  readonly queuedCount: number;
  readonly activeCount: number;
}

export interface QueueSource {
  getQueues(): Promise<QueueCounts[]>;
}

/**
 * Per-queue job counts, read from pg-boss on every export cycle.
 *
 * The queue list comes from pg-boss at runtime, not `QUEUE_DEFINITIONS`, so
 * queues created elsewhere and new queues are covered without anyone
 * remembering to list them. The only attribute is the queue name; job data
 * never reaches a metric.
 *
 * Counts are database-wide, so every pod reports the same number. Query with
 * `max`, never `sum`.
 */
@Injectable()
export class QueueMetricsService implements OnModuleInit {
  private readonly logger = new Logger(QueueMetricsService.name);

  private waiting?: ObservableGauge;

  private running?: ObservableGauge;

  private deadLettered?: ObservableGauge;

  // Optional so modules that import the metrics without pg-boss (some
  // integration specs) still resolve; there is then nothing to observe.
  public constructor(
    @Optional() @Inject(PG_BOSS) private readonly boss?: QueueSource,
  ) {}

  public onModuleInit(): void {
    if (this.boss === undefined) {
      return;
    }

    this.register(this.meter());
  }

  /** Registers the instruments and the callback that feeds them. */
  public register(meter: Meter): void {
    this.waiting = meter.createObservableGauge(QUEUE_WAITING_METRIC, {
      description:
        'Jobs ready to run but not yet picked up (pg-boss readyCount), by queue.',
      unit: '{job}',
    });
    this.running = meter.createObservableGauge(QUEUE_RUNNING_METRIC, {
      description: 'Jobs picked up and in progress, by queue.',
      unit: '{job}',
    });
    this.deadLettered = meter.createObservableGauge(
      QUEUE_DEAD_LETTERED_METRIC,
      {
        description:
          'Jobs sitting in the queue dead-letter partner after exhausting retries, by queue.',
        unit: '{job}',
      },
    );

    meter.addBatchObservableCallback(
      (result) => this.observe(result),
      [this.waiting, this.running, this.deadLettered],
    );
  }

  public async observe(result: BatchObservableResult): Promise<void> {
    if (
      this.boss === undefined ||
      this.waiting === undefined ||
      this.running === undefined ||
      this.deadLettered === undefined
    ) {
      return;
    }

    // Telemetry must not throw into the SDK's export cycle; a failed read
    // simply reports nothing this cycle.
    let queues: QueueCounts[];

    try {
      queues = await this.boss.getQueues();
    } catch (error) {
      this.logger.warn(`Failed to read pg-boss queue counts: ${String(error)}`);
      return;
    }

    const byName = new Map(queues.map((queue) => [queue.name, queue]));

    for (const queue of queues) {
      if (queue.name.startsWith(INTERNAL_QUEUE_PREFIX)) {
        continue;
      }

      const attributes = { [ATTR_QUEUE_NAME]: boundedLabel(queue.name) };

      result.observe(this.waiting, queue.readyCount, attributes);
      result.observe(this.running, queue.activeCount, attributes);

      const partner =
        queue.deadLetter === undefined
          ? undefined
          : byName.get(queue.deadLetter);

      if (partner !== undefined) {
        result.observe(this.deadLettered, partner.queuedCount, attributes);
      }
    }
  }

  private meter(): Meter {
    return metrics.getMeter(METER_NAME);
  }
}
