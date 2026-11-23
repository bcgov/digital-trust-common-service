import { createHmac } from 'node:crypto';
import { request as httpsRequest, Agent } from 'node:https';
import { isIP } from 'node:net';

import { JOB_QUEUES } from '@app/pg-boss';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'pg-boss';

import { assertSafePublicHttpsUrl } from '../common/assert-safe-connector-url';
import { EncryptionService } from '../common/crypto/encryption.service';
import { JobsService } from '../jobs/jobs.service';

import { WebhookRegistration } from './webhook-registration.entity';
import { WebhookEvent } from './webhook-registration.enums';
import { WebhookRegistrationRepository } from './webhook-registration.repository';

/** Contract producers (ProtocolStateChangeService, CredentialActionService) enqueue. */
export type WebhookDispatchJobData = {
  tenantId: string;
  event: string;
  resourceId: string;
  occurredAt: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DELIVERY_TIMEOUT_MS = 10_000;

/**
 * Delivers each queued event to active tenant registrations that subscribe to
 * that event. A failed delivery rejects the job so pg-boss applies the queue's
 * existing retry and dead-letter policy.
 */
@Injectable()
export class WebhookDispatchWorker implements OnModuleInit {
  private readonly logger = new Logger(WebhookDispatchWorker.name);

  public constructor(
    private readonly jobsService: JobsService,
    private readonly config: ConfigService,
    private readonly registrations: WebhookRegistrationRepository,
    private readonly encryption: EncryptionService,
  ) {}

  public async onModuleInit(): Promise<void> {
    const workersEnabled =
      this.config.get<string>('PG_BOSS_WORKERS_ENABLED', 'true') !== 'false';

    await this.jobsService.registerWorker<WebhookDispatchJobData>(
      JOB_QUEUES.WEBHOOK_DISPATCH,
      async (job) => this.handle(job),
      { enabled: workersEnabled, teamConcurrency: 3 },
    );
  }

  public async handle(job: Job<WebhookDispatchJobData>): Promise<void> {
    const data = this.assertValidPayload(job.data);
    const event = Object.values(WebhookEvent).find(
      (supportedEvent) => String(supportedEvent) === data.event,
    );
    if (!event) return;
    const registrations: WebhookRegistration[] =
      await this.registrations.findActiveForDispatch(data.tenantId);
    const matching = registrations.filter((registration) =>
      registration.events.includes(event),
    );
    if (matching.length === 0) return;

    const body = JSON.stringify({
      id: job.id,
      tenant_id: data.tenantId,
      event: data.event,
      resource_id: data.resourceId,
      occurred_at: data.occurredAt,
    });
    const results = await Promise.allSettled(
      matching.map((registration) =>
        this.deliver(registration, data, job.id, body),
      ),
    );
    const failed = results
      .map((result, index) => ({ result, registration: matching[index] }))
      .filter(
        (
          entry,
        ): entry is {
          result: PromiseRejectedResult;
          registration: WebhookRegistration;
        } =>
          entry.result.status === 'rejected' &&
          entry.registration !== undefined,
      );
    for (const { result, registration } of failed) {
      let endpointHost: string;
      try {
        endpointHost = new URL(registration.endpointUrl).host;
      } catch {
        endpointHost = 'invalid-url';
      }
      this.logger.error(
        {
          job_id: job.id,
          tenant_id: data.tenantId,
          event: data.event,
          resource_id: data.resourceId,
          registration_id: registration.id,
          endpoint_host: endpointHost,
          failure_reason:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        },
        'Webhook registration delivery failed',
      );
    }
    if (failed.length > 0) {
      throw new Error(
        `Webhook delivery failed for ${failed.length} of ${matching.length} registrations.`,
      );
    }
  }

  private async deliver(
    registration: WebhookRegistration,
    data: WebhookDispatchJobData,
    deliveryId: string,
    body: string,
  ): Promise<void> {
    const { signingSecret } = this.encryption.decrypt<{
      signingSecret: string;
    }>(registration.credentialsEncrypted, registration.keyVersion);
    const addresses = await assertSafePublicHttpsUrl(
      registration.endpointUrl,
      'Webhook endpoint',
    );
    const selectedAddress = addresses[0];
    if (!selectedAddress) throw new Error('Webhook endpoint has no address.');
    const signature = createHmac('sha256', signingSecret)
      .update(body, 'utf8')
      .digest('hex');
    const endpoint = new URL(registration.endpointUrl);
    const pinnedAddresses = addresses.map((address) => ({
      address,
      family: isIP(address),
    }));
    const agent = new Agent({
      lookup: (_hostname, options, callback) => {
        const candidates = options.family
          ? pinnedAddresses.filter(({ family }) => family === options.family)
          : pinnedAddresses;
        if (candidates.length === 0) {
          callback(
            Object.assign(
              new Error('Webhook endpoint address family is unavailable.'),
              { code: 'ENOTFOUND' },
            ),
            '',
            0,
          );
        } else if (options.all) {
          callback(null, candidates);
        } else {
          callback(null, candidates[0].address, candidates[0].family);
        }
      },
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        agent.destroy();
        if (error) reject(error);
        else resolve();
      };
      const request = httpsRequest(
        endpoint,
        {
          method: 'POST',
          agent,
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            'x-webhook-event': data.event,
            'x-webhook-delivery': deliveryId,
            'x-webhook-signature': `sha256=${signature}`,
          },
        },
        (response) => {
          response.once('error', () =>
            finish(new Error('Webhook delivery response failed.')),
          );
          response.resume();
          response.once('end', () => {
            const status = response.statusCode ?? 0;
            if (status < 200 || status >= 300) {
              finish(new Error(`Webhook endpoint returned HTTP ${status}.`));
            } else {
              finish();
            }
          });
        },
      );
      const timeout = setTimeout(
        () => request.destroy(new Error('Webhook delivery timed out.')),
        DELIVERY_TIMEOUT_MS,
      );
      request.once('error', () =>
        finish(new Error('Webhook delivery request failed.')),
      );
      request.end(body);
    });
  }

  public enqueue(data: WebhookDispatchJobData): Promise<string | null> {
    return this.jobsService.publish(JOB_QUEUES.WEBHOOK_DISPATCH, data);
  }

  private assertValidPayload(
    data: WebhookDispatchJobData | undefined,
  ): WebhookDispatchJobData {
    if (
      !data?.tenantId ||
      typeof data.event !== 'string' ||
      !data.event ||
      typeof data.resourceId !== 'string' ||
      !data.resourceId ||
      typeof data.occurredAt !== 'string' ||
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
