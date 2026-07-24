import { JOB_QUEUES } from '@app/pg-boss';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'pg-boss';

import { JobsService } from '../jobs/jobs.service';

import { AuditAction, AuditActorType } from './audit-log.entity';
import { AuditLogService } from './audit-log.service';

export type AuditWriteJobData = {
  tenantId: string;
  actorId: string;
  actorType: AuditActorType;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  operationId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AuditWriteWorker implements OnModuleInit {
  private readonly logger = new Logger(AuditWriteWorker.name);

  public constructor(
    private readonly jobsService: JobsService,
    private readonly auditLogService: AuditLogService,
    private readonly config: ConfigService,
  ) {}

  public async onModuleInit(): Promise<void> {
    const workersEnabled =
      this.config.get<string>('PG_BOSS_WORKERS_ENABLED', 'true') !== 'false';

    await this.jobsService.registerWorker<AuditWriteJobData>(
      JOB_QUEUES.AUDIT_WRITE,
      async (job) => this.handle(job),
      { enabled: workersEnabled },
    );
  }

  public async handle(job: Job<AuditWriteJobData>): Promise<void> {
    const data = this.assertValidPayload(job.data);
    await this.auditLogService.write(data);
    this.logger.debug(`Wrote audit log from job ${job.id}`);
  }

  /** Helper for producers / tests to enqueue an audit.write job. */
  public enqueue(data: AuditWriteJobData): Promise<string | null> {
    return this.jobsService.publish(JOB_QUEUES.AUDIT_WRITE, data);
  }

  private assertValidPayload(
    data: AuditWriteJobData | undefined,
  ): AuditWriteJobData {
    if (
      !data?.tenantId ||
      !data.actorId ||
      !data.actorType ||
      !data.action ||
      !data.resourceType ||
      !data.resourceId
    ) {
      throw new Error('Invalid audit.write payload');
    }

    if (
      !UUID_RE.test(data.tenantId) ||
      !UUID_RE.test(data.resourceId) ||
      (data.operationId != null &&
        data.operationId !== '' &&
        !UUID_RE.test(data.operationId))
    ) {
      throw new Error('Invalid audit.write payload');
    }

    if (!Object.values(AuditActorType).includes(data.actorType)) {
      throw new Error('Invalid audit.write payload');
    }

    if (!Object.values(AuditAction).includes(data.action)) {
      throw new Error('Invalid audit.write payload');
    }

    return data;
  }
}
