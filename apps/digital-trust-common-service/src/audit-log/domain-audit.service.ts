import { Injectable, Logger } from '@nestjs/common';

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

  public async emit(input: DomainAuditEmitInput): Promise<void> {
    try {
      await this.auditWriteWorker.enqueue({
        tenantId: input.tenantId,
        actorId: 'system',
        actorType: AuditActorType.SYSTEM,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        metadata: input.metadata ?? {},
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to enqueue audit.write for ${input.action} ${input.resourceType}/${input.resourceId}: ${message}`,
      );
    }
  }
}
