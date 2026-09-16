import { Injectable, Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { AuditAction, AuditActorType } from './audit-log.entity';
import { AuditWriteWorker } from './audit-write.worker';

export type DomainAuditEmitInput = {
  tenantId: string;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
};

/**
 * Fail-open helper for domain mutation producers.
 * Actor identity is system until AU-04 provides request context.
 */
@Injectable()
export class DomainAuditService {
  private readonly logger = new Logger(DomainAuditService.name);

  public constructor(private readonly auditWriteWorker: AuditWriteWorker) {}

  /**
   * Pass `manager` when the mutation this audits is itself running inside a
   * transaction, so the audit-write enqueue commits or rolls back with it
   * atomically instead of publishing independently — see
   * AuditWriteWorker.enqueue.
   */
  public async emit(
    input: DomainAuditEmitInput,
    manager?: EntityManager,
  ): Promise<void> {
    try {
      await this.auditWriteWorker.enqueue(
        {
          tenantId: input.tenantId,
          actorId: 'system',
          actorType: AuditActorType.SYSTEM,
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          metadata: input.metadata ?? {},
        },
        manager,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to enqueue audit.write for ${input.action} ${input.resourceType}/${input.resourceId}: ${message}`,
      );
    }
  }
}
