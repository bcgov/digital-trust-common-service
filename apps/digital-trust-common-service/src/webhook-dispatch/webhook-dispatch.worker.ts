import { JOB_QUEUES } from '@app/pg-boss';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'pg-boss';

import { JobsService } from '../jobs/jobs.service';

/** Contract producers (ProtocolStateChangeService, CredentialActionService) enqueue. */
export type WebhookDispatchJobData = {
  tenantId: string;
  event: string;
  resourceId: string;
  occurredAt: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Drains `webhook.dispatch` so jobs enqueued by ProtocolStateChangeService and
 * CredentialActionService don't sit unprocessed forever.
 *
 * This is a stub, not a delivery implementation: there is no tenant webhook
 * subscription model, signing secret, or HTTP delivery client yet — that is
 * a separate follow-up ticket. A validly-shaped job is logged and
 * acknowledged (so it never retries or dead-letters), but no webhook request
 * is actually sent to a tenant. A malformed job (assertValidPayload throws)
 * is rejected instead and still follows pg-boss's normal retry/dead-letter
 * behavior.
 */
@Injectable()
export class WebhookDispatchWorker implements OnModuleInit {
  private readonly logger = new Logger(WebhookDispatchWorker.name);

  public constructor(
    private readonly jobsService: JobsService,
    private readonly config: ConfigService,
  ) {}

  public async onModuleInit(): Promise<void> {
    const workersEnabled =
      this.config.get<string>('PG_BOSS_WORKERS_ENABLED', 'true') !== 'false';

    await this.jobsService.registerWorker<WebhookDispatchJobData>(
      JOB_QUEUES.WEBHOOK_DISPATCH,
      async (job) => this.handle(job),
      { enabled: workersEnabled },
    );
  }

  public async handle(job: Job<WebhookDispatchJobData>): Promise<void> {
    const data = this.assertValidPayload(job.data);

    this.logger.warn(
      `webhook.dispatch job ${job.id} acknowledged without delivery (no tenant ` +
        `webhook subscriber implemented yet): tenant=${data.tenantId} ` +
        `event=${data.event} resourceId=${data.resourceId}`,
    );

    return Promise.resolve();
  }

  public enqueue(data: WebhookDispatchJobData): Promise<string | null> {
    return this.jobsService.publish(JOB_QUEUES.WEBHOOK_DISPATCH, data);
  }

  private assertValidPayload(
    data: WebhookDispatchJobData | undefined,
  ): WebhookDispatchJobData {
    if (
      !data?.tenantId ||
      !data.event ||
      !data.resourceId ||
      !data.occurredAt
    ) {
      throw new Error('Invalid webhook.dispatch payload');
    }

    if (!UUID_RE.test(data.tenantId)) {
      throw new Error('Invalid webhook.dispatch payload');
    }

    return data;
  }
}
