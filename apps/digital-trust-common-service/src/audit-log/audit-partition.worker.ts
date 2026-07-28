import { buildMonthlyPartitionSpecs } from '@app/database';
import { JOB_QUEUES } from '@app/pg-boss';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Job } from 'pg-boss';
import { DataSource } from 'typeorm';

import { JobsService } from '../jobs/jobs.service';

export type AuditPartitionMaintainJobData = {
  monthsAhead?: number;
};

@Injectable()
export class AuditPartitionWorker implements OnModuleInit {
  private readonly logger = new Logger(AuditPartitionWorker.name);

  public constructor(
    private readonly jobsService: JobsService,
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  public async onModuleInit(): Promise<void> {
    const workersEnabled =
      this.config.get<string>('PG_BOSS_WORKERS_ENABLED', 'true') !== 'false';

    await this.jobsService.registerWorker<AuditPartitionMaintainJobData>(
      JOB_QUEUES.AUDIT_PARTITION_MAINTAIN,
      async (job) => this.handle(job),
      { enabled: workersEnabled },
    );

    if (!workersEnabled) {
      return;
    }

    const cron = this.config.get<string>('AUDIT_PARTITION_CRON', '0 3 * * *');
    await this.jobsService.schedule(
      JOB_QUEUES.AUDIT_PARTITION_MAINTAIN,
      cron,
      {},
    );

    // Ensure partitions exist immediately on startup (fresh envs / after deploy).
    await this.jobsService.publish(JOB_QUEUES.AUDIT_PARTITION_MAINTAIN, {});
  }

  public async handle(job: Job<AuditPartitionMaintainJobData>): Promise<void> {
    const monthsAhead = Number(
      job.data?.monthsAhead ??
        this.config.get<string>('AUDIT_PARTITION_MONTHS_AHEAD', '3'),
    );

    const specs = buildMonthlyPartitionSpecs(new Date(), monthsAhead);

    for (const spec of specs) {
      await this.dataSource.query(
        `
        CREATE TABLE IF NOT EXISTS ${spec.name}
          PARTITION OF audit_log
          FOR VALUES FROM ('${spec.from}') TO ('${spec.to}')
        `,
      );
      this.logger.debug(
        `Ensured partition ${spec.name} [${spec.from} .. ${spec.to})`,
      );
    }

    this.logger.log(
      `audit.partition-maintain ensured ${specs.length} partition(s) (monthsAhead=${monthsAhead})`,
    );
  }
}
