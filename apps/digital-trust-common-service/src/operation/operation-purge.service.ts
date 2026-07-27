import { PgBossService } from '@app/pg-boss';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { OperationRepository, PurgeTenantCount } from './operation.repository';

export const OPERATION_PURGE_QUEUE = 'operation-purge';

// Hourly cron (top of every hour).
const PURGE_SCHEDULE_CRON = '0 * * * *';

// Each batch deletes at most this many expired rows to avoid long-held locks
// on the operation table.
const BATCH_SIZE = 500;

// Safety cap on batches processed per job run so a large backlog can't make a
// single run run indefinitely; any remainder is purged on the next scheduled run.
const MAX_BATCHES_PER_RUN = 50;

@Injectable()
export class OperationPurgeService implements OnModuleInit {
  private readonly logger = new Logger(OperationPurgeService.name);

  public constructor(
    private readonly bossService: PgBossService,
    private readonly operations: OperationRepository,
  ) {}

  public async onModuleInit(): Promise<void> {
    const { boss } = this.bossService;

    await boss.createQueue(OPERATION_PURGE_QUEUE);
    await boss.schedule(OPERATION_PURGE_QUEUE, PURGE_SCHEDULE_CRON);
    await boss.work(OPERATION_PURGE_QUEUE, () => this.purgeExpiredOperations());
  }

  /**
   * Repeatedly deletes batches of expired operations (expires_at < now()),
   * logging the purge count per tenant, until either the backlog is drained
   * or the per-run batch cap is reached.
   */
  public async purgeExpiredOperations(): Promise<void> {
    const totalsByTenant = new Map<string, number>();
    let batches = 0;
    let batchCount = 0;

    do {
      let batch: PurgeTenantCount[];

      try {
        batch = await this.operations.purgeExpiredBatch(BATCH_SIZE);
      } catch (error) {
        this.logger.error(
          'Failed to purge a batch of expired operations',
          error instanceof Error ? error.stack : String(error),
        );
        throw error;
      }

      batchCount = batch.reduce((sum, entry) => sum + entry.count, 0);
      batches += 1;

      for (const entry of batch) {
        totalsByTenant.set(
          entry.tenantId,
          (totalsByTenant.get(entry.tenantId) ?? 0) + entry.count,
        );
      }
    } while (batchCount > 0 && batches < MAX_BATCHES_PER_RUN);

    const totalPurged = Array.from(totalsByTenant.values()).reduce(
      (sum, count) => sum + count,
      0,
    );

    if (totalPurged === 0) {
      this.logger.log('Operation purge run complete: no expired operations');
      return;
    }

    for (const [tenantId, count] of totalsByTenant) {
      this.logger.log(
        `Purged ${count} expired operation(s) for tenant ${tenantId}`,
      );
    }

    this.logger.log(
      `Operation purge run complete: purged ${totalPurged} operation(s) across ${totalsByTenant.size} tenant(s) in ${batches} batch(es)`,
    );
  }
}
