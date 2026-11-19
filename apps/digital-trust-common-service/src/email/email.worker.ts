import { JOB_QUEUES } from '@app/pg-boss';
import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isUUID } from 'class-validator';
import type { Job } from 'pg-boss';
import { DataSource } from 'typeorm';

import { JobsService, SafeJobFailure } from '../jobs/jobs.service';
import { TenantUserRepository } from '../tenant-user/tenant-user.repository';

import { EmailSendQuotaRepository } from './email-send-quota.repository';
import { EmailDeliveryError, EmailProvider } from './email.provider';
import { EmailKind, type SendEmailRequest } from './email.service';

@Injectable()
export class EmailWorker implements OnModuleInit {
  public constructor(
    private readonly jobsService: JobsService,
    private readonly config: ConfigService,
    private readonly tenantUsers: TenantUserRepository,
    private readonly quota: EmailSendQuotaRepository,
    private readonly dataSource: DataSource,
    @Optional()
    @Inject(EmailProvider)
    private readonly provider?: EmailProvider | null,
  ) {}

  public async onModuleInit(): Promise<void> {
    await this.jobsService.registerWorker<SendEmailRequest>(
      JOB_QUEUES.EMAIL_SEND,
      (job) => this.handle(job),
      {
        includeMetadata: true,
        enabled:
          Boolean(this.provider) &&
          this.config.get<string>('PG_BOSS_WORKERS_ENABLED', 'true') !==
            'false',
      },
    );
  }

  public async handle(job: Job<SendEmailRequest>): Promise<void> {
    const data = job.data;
    if (
      data?.kind !== EmailKind.TENANT_INVITATION ||
      !isUUID(data.tenantId) ||
      !isUUID(data.invitationId)
    ) {
      throw new SafeJobFailure('Invalid email job payload.');
    }
    if (!this.provider) {
      throw new SafeJobFailure('Email provider is not configured.');
    }

    const invitation = await this.tenantUsers.findPendingInvitation(
      data.tenantId,
      data.invitationId,
    );
    if (!invitation?.tenant) return;

    const signInUrl = new URL(
      '/login',
      this.config.getOrThrow<string>('APP_PUBLIC_URL'),
    ).href;

    if (this.provider.countsTowardQuota) {
      const retryAt = await this.quota.reserve(data.tenantId);
      if (retryAt) {
        await this.dataSource.transaction((manager) =>
          this.jobsService.deferInTransaction(manager, job, retryAt),
        );
        return;
      }
    }

    try {
      await this.provider.send({
        kind: data.kind,
        to: invitation.email,
        tenantName: invitation.tenant.name,
        signInUrl,
      });
    } catch (error) {
      throw new SafeJobFailure(
        error instanceof EmailDeliveryError
          ? error.message
          : 'Email provider failed to send invitation.',
      );
    }
  }
}
