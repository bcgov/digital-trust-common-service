import { JOB_QUEUES } from '@app/pg-boss';
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { JobsService } from '../jobs/jobs.service';

export enum EmailKind {
  TENANT_INVITATION = 'tenant-invitation',
}

export interface SendEmailRequest {
  kind: EmailKind.TENANT_INVITATION;
  tenantId: string;
  invitationId: string;
}

@Injectable()
export class EmailService {
  public constructor(private readonly jobsService: JobsService) {}

  public enqueue(
    { kind, tenantId, invitationId }: SendEmailRequest,
    manager?: EntityManager,
  ): Promise<string | null> {
    const data = { kind, tenantId, invitationId };
    return manager
      ? this.jobsService.sendInTransaction(manager, JOB_QUEUES.EMAIL_SEND, data)
      : this.jobsService.publish(JOB_QUEUES.EMAIL_SEND, data);
  }
}
