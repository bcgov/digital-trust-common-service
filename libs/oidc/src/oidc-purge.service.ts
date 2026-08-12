import { PgBossService } from '@app/pg-boss';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { OidcPurgeRepository, PurgeModelCount } from './oidc-purge.repository';

export const OIDC_PURGE_QUEUE = 'oidc-purge';

// Hourly cron (top of every hour).
const PURGE_SCHEDULE_CRON = '0 * * * *';

// Each batch deletes at most this many expired rows to avoid long-held locks
// on the oidc_model table.
const BATCH_SIZE = 500;

// Safety cap on batches processed per job run so a large backlog can't make a
// single run continue indefinitely; any remainder is purged on the next scheduled run.
const MAX_BATCHES_PER_RUN = 50;

/**
 * Hourly pg-boss job that deletes expired `oidc_model` rows (sessions,
 * authorization codes, access/refresh tokens, interactions, etc) and expired
 * `oidc_upstream_interaction` records. Mirrors `OperationPurgeService`'s
 * batching/scheduling pattern.
 */
@Injectable()
export class OidcPurgeService implements OnModuleInit {
  private readonly logger = new Logger(OidcPurgeService.name);

  public constructor(
    private readonly bossService: PgBossService,
    private readonly purgeRepository: OidcPurgeRepository,
  ) {}

  public async onModuleInit(): Promise<void> {
    const { boss } = this.bossService;

    // 'exclusive' policy: at most one purge job may be queued OR active at a
    // time across the whole cluster. The purge is an idempotent cleanup sweep,
    // so if a run ever outlives its hourly schedule (large backlog), the next
    // tick's job is dropped rather than run concurrently; the following
    // scheduled run drains the remainder. This guarantees a single pod runs the
    // purge at a time without leader election. See pg-boss QueuePolicy docs.
    await boss.createQueue(OIDC_PURGE_QUEUE, { policy: 'exclusive' });
    await boss.schedule(OIDC_PURGE_QUEUE, PURGE_SCHEDULE_CRON);
    await boss.work(OIDC_PURGE_QUEUE, () => this.purgeExpiredModels());
  }

  /**
   * Repeatedly deletes batches of expired oidc_model rows and
   * oidc_upstream_interaction records (expires_at < now()), logging the
   * purge count per type, until either the backlog is drained or the
   * per-run batch cap is reached.
   */
  public async purgeExpiredModels(): Promise<void> {
    const totalsByModel = new Map<string, number>();
    let upstreamInteractionsTotal = 0;
    let batches = 0;
    let batchCount = 0;

    do {
      let batch: PurgeModelCount[];
      let upstreamCount = 0;

      try {
        batch = await this.purgeRepository.purgeExpiredBatch(BATCH_SIZE);
        const upstreamResult =
          await this.purgeRepository.purgeExpiredUpstreamInteractionsBatch(
            BATCH_SIZE,
          );
        upstreamCount = upstreamResult.count;
      } catch (error) {
        this.logger.error(
          'Failed to purge a batch of expired OIDC records',
          error instanceof Error ? error.stack : String(error),
        );
        throw error;
      }

      batchCount = batch.reduce((sum, entry) => sum + entry.count, 0);
      batches += 1;

      for (const entry of batch) {
        totalsByModel.set(
          entry.modelName,
          (totalsByModel.get(entry.modelName) ?? 0) + entry.count,
        );
      }

      upstreamInteractionsTotal += upstreamCount;
    } while (batchCount > 0 && batches < MAX_BATCHES_PER_RUN);

    const totalPurged = Array.from(totalsByModel.values()).reduce(
      (sum, count) => sum + count,
      0,
    );

    if (totalPurged === 0 && upstreamInteractionsTotal === 0) {
      this.logger.log('OIDC purge run complete: no expired records');
      return;
    }

    for (const [modelName, count] of totalsByModel) {
      this.logger.log(`Purged ${count} expired ${modelName} record(s)`);
    }

    if (upstreamInteractionsTotal > 0) {
      this.logger.log(
        `Purged ${upstreamInteractionsTotal} expired upstream interaction record(s)`,
      );
    }

    this.logger.log(
      `OIDC purge run complete: purged ${totalPurged + upstreamInteractionsTotal} total record(s) in ${batches} batch(es)`,
    );
  }
}
