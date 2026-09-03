import { JOB_QUEUES } from '@app/pg-boss';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'pg-boss';

import { JobsService } from '../jobs/jobs.service';

import { RateLimitHitRepository } from './rate-limit-hit.repository';

export type RateLimitPruneJobData = Record<string, never>;

/**
 * Deletes `rate_limit_hits` rows older than the retention window on an
 * hourly cron. Retention must stay comfortably longer than the widest
 * throttle `ttl` in use (including any per-endpoint `@Throttle()`
 * override), or a still-open sliding window would lose hits it needs to
 * count.
 */
@Injectable()
export class RateLimitPruneWorker implements OnModuleInit {
  private readonly logger = new Logger(RateLimitPruneWorker.name);

  public constructor(
    private readonly jobsService: JobsService,
    private readonly config: ConfigService,
    private readonly hits: RateLimitHitRepository,
  ) {}

  public async onModuleInit(): Promise<void> {
    const workersEnabled =
      this.config.get<string>('PG_BOSS_WORKERS_ENABLED', 'true') !== 'false';

    await this.jobsService.registerWorker<RateLimitPruneJobData>(
      JOB_QUEUES.RATE_LIMIT_PRUNE,
      async (job) => this.handle(job),
      { enabled: workersEnabled },
    );

    if (!workersEnabled) {
      return;
    }

    const cron = this.config.get<string>('RATE_LIMIT_PRUNE_CRON', '0 * * * *');
    await this.jobsService.schedule(JOB_QUEUES.RATE_LIMIT_PRUNE, cron, {});
  }

  public async handle(_job: Job<RateLimitPruneJobData>): Promise<void> {
    const retentionMinutes = Number(
      this.config.get<string>('RATE_LIMIT_HIT_RETENTION_MINUTES', '5'),
    );
    const minutes =
      Number.isFinite(retentionMinutes) && retentionMinutes > 0
        ? retentionMinutes
        : 5;

    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    const deleted = await this.hits.pruneOlderThan(cutoff);

    this.logger.log(
      `rate-limit.prune deleted ${deleted} hit(s) older than ${minutes}m`,
    );
  }
}
