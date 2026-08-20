import { PgBossService } from '@app/pg-boss';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';

import {
  ExpiredSessionWithUpstreamCleanup,
  OidcPurgeRepository,
  PurgeModelCount,
} from './oidc-purge.repository';
import { OIDC_UPSTREAM_FEDERATION_PORT } from './ports/oidc-upstream-federation.port';
import type { OidcUpstreamFederationPort } from './ports/oidc-upstream-federation.port';

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
    @Inject(OIDC_UPSTREAM_FEDERATION_PORT)
    private readonly upstreamFederation: OidcUpstreamFederationPort,
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
   *
   * Before deleting expired Session models, schedules upstream logout cleanup
   * for sessions with upstream federation links.
   */
  public async purgeExpiredModels(): Promise<void> {
    const totalsByModel = new Map<string, number>();
    let upstreamInteractionsTotal = 0;
    let upstreamLogoutScheduledCount = 0;
    let expiredPendingSessionsDeletedCount = 0;
    let batches = 0;
    let batchCount = 0;

    do {
      let batch: PurgeModelCount[];
      let upstreamCount = 0;

      try {
        // Before purging, schedule upstream logout cleanup for Sessions with
        // upstream sessions. This ensures expired sessions are cleaned up
        // upstream before cascade deletion.
        const sessionsToCleanup: ExpiredSessionWithUpstreamCleanup[] =
          await this.purgeRepository.getExpiredSessionsWithUpstreamCleanup(
            BATCH_SIZE,
          );

        for (const session of sessionsToCleanup) {
          try {
            await this.upstreamFederation.logoutUpstreamSessionForOidcSession({
              oidcModelId: session.oidcModelId,
              oidcSessionUid: session.oidcSessionUid,
            });
            upstreamLogoutScheduledCount += 1;
          } catch (err) {
            // Log the error but continue; upstream logout is best-effort.
            // If it fails, the local session is still cleaned up.
            const errorMessage =
              err instanceof Error ? err.message : String(err);
            this.logger.warn(
              `Failed to logout upstream session for oidc model ${session.oidcModelId}: ${errorMessage}`,
            );
          }
        }

        // Delete expired pending sessions that accumulated when finalization
        // failed after callback staging. These cannot be cascade-deleted by
        // oidc_model cleanup.
        const deletedPendingCount =
          await this.upstreamFederation.deleteExpiredPendingSessionBatch(
            BATCH_SIZE,
          );
        expiredPendingSessionsDeletedCount += deletedPendingCount;

        batch = await this.purgeRepository.purgeExpiredBatch(BATCH_SIZE);
        const upstreamResult =
          await this.purgeRepository.purgeExpiredUpstreamInteractionsBatch(
            BATCH_SIZE,
          );
        upstreamCount = upstreamResult.count;
      } catch (err) {
        const errorToThrow =
          err instanceof Error ? err : new Error(String(err));
        this.logger.error(
          `Failed to purge a batch of expired OIDC records: ${errorToThrow.message}`,
          errorToThrow,
        );
        throw errorToThrow;
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

    if (
      totalPurged === 0 &&
      upstreamInteractionsTotal === 0 &&
      expiredPendingSessionsDeletedCount === 0
    ) {
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

    if (expiredPendingSessionsDeletedCount > 0) {
      this.logger.log(
        `Deleted ${expiredPendingSessionsDeletedCount} expired pending upstream session(s)`,
      );
    }

    if (upstreamLogoutScheduledCount > 0) {
      this.logger.log(
        `Scheduled upstream logout cleanup for ${upstreamLogoutScheduledCount} expired session(s)`,
      );
    }

    this.logger.log(
      `OIDC purge run complete: purged ${totalPurged + upstreamInteractionsTotal + expiredPendingSessionsDeletedCount} total record(s) in ${batches} batch(es)`,
    );
  }
}
