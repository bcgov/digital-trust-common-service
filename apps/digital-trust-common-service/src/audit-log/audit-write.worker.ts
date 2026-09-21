import { JOB_QUEUES } from '@app/pg-boss';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'pg-boss';
import type { EntityManager } from 'typeorm';

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

  /**
   * Helper for producers / tests to enqueue an audit.write job. Pass the
   * caller's `manager` when the audit is being emitted alongside a guarded
   * state write inside a transaction (e.g. protocol-state-change.service.ts),
   * so the enqueue commits or rolls back atomically with that write instead
   * of publishing independently via pg-boss's own connection — otherwise a
   * later rollback of the caller's transaction could leave behind an audit
   * record for a state change that never actually took effect.
   */
  public enqueue(
    data: AuditWriteJobData,
    manager?: EntityManager,
  ): Promise<string | null> {
    return manager
      ? this.jobsService.sendInTransaction(
          manager,
          JOB_QUEUES.AUDIT_WRITE,
          data,
        )
      : this.jobsService.publish(JOB_QUEUES.AUDIT_WRITE, data);
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

    const operationId =
      data.operationId === '' || data.operationId == null
        ? null
        : data.operationId;

    if (
      !UUID_RE.test(data.tenantId) ||
      !UUID_RE.test(data.resourceId) ||
      (operationId != null && !UUID_RE.test(operationId))
    ) {
      throw new Error('Invalid audit.write payload');
    }

    if (!Object.values(AuditActorType).includes(data.actorType)) {
      throw new Error('Invalid audit.write payload');
    }

    if (!Object.values(AuditAction).includes(data.action)) {
      throw new Error('Invalid audit.write payload');
    }

    return { ...data, operationId };
  }
}
