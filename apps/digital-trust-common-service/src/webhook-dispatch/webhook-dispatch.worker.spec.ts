import { createHmac, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Agent, request as httpsRequest } from 'node:https';

import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Job } from 'pg-boss';

import { assertSafePublicHttpsUrl } from '../common/assert-safe-connector-url';
import { EncryptionService } from '../common/crypto/encryption.service';
import { JobsService } from '../jobs/jobs.service';

import { WebhookDispatchModule } from './webhook-dispatch.module';
import {
  WebhookDispatchJobData,
  WebhookDispatchWorker,
} from './webhook-dispatch.worker';
import { WebhookRegistrationController } from './webhook-registration.controller';
import { WebhookEvent } from './webhook-registration.enums';
import { WebhookRegistrationRepository } from './webhook-registration.repository';

jest.mock('node:https', () => ({
  ...jest.requireActual<typeof import('node:https')>('node:https'),
  request: jest.fn(),
}));

jest.mock('../common/assert-safe-connector-url', () => ({
  assertSafePublicHttpsUrl: jest.fn().mockResolvedValue(['93.184.216.34']),
}));

describe('WebhookDispatchWorker', () => {
  let worker: WebhookDispatchWorker;
  let mockRegisterWorker: jest.Mock;
  let mockPublish: jest.Mock;
  const registrations = { findActiveForDispatch: jest.fn() };
  const encryption = { decrypt: jest.fn() };
  const signingSecret = randomBytes(32).toString('base64url');

  beforeEach(async () => {
    registrations.findActiveForDispatch.mockClear();
    encryption.decrypt.mockClear();
    mockRegisterWorker = jest.fn().mockResolvedValue('worker-1');
    mockPublish = jest.fn().mockResolvedValue('job-1');
    registrations.findActiveForDispatch.mockResolvedValue([]);
    encryption.decrypt.mockReturnValue({ signingSecret });
    jest.mocked(httpsRequest).mockReset();
    jest.mocked(assertSafePublicHttpsUrl).mockResolvedValue(['93.184.216.34']);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookDispatchWorker,
        { provide: WebhookRegistrationRepository, useValue: registrations },
        { provide: EncryptionService, useValue: encryption },
        {
          provide: JobsService,
          useValue: {
            registerWorker: mockRegisterWorker,
            publish: mockPublish,
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((_key: string, fallback?: string) => fallback),
          },
        },
      ],
    }).compile();

    worker = module.get(WebhookDispatchWorker);
  });

  it('registers the webhook.dispatch worker on init', async () => {
    await worker.onModuleInit();

    expect(mockRegisterWorker).toHaveBeenCalledWith(
      'webhook.dispatch',
      expect.any(Function),
      { enabled: true },
    );
  });

  it('registers the API controller in the shared webhook module', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, WebhookDispatchModule),
    ).toContain(WebhookRegistrationController);
  });

  it('acknowledges a valid event when no active registrations subscribe to it', async () => {
    const job = {
      id: 'job-1',
      data: {
        tenantId: '123e4567-e89b-12d3-a456-426614174001',
        event: 'credential.issued',
        resourceId: 'ext-1',
        occurredAt: '2024-01-01T00:00:00.000Z',
      },
    } as Job<WebhookDispatchJobData>;

    await expect(worker.handle(job)).resolves.toBeUndefined();
    expect(registrations.findActiveForDispatch).toHaveBeenCalledWith(
      job.data.tenantId,
    );
    expect(encryption.decrypt).not.toHaveBeenCalled();
  });

  it('acknowledges valid events that are not in the registration contract', async () => {
    const job = {
      id: 'job-1',
      data: {
        tenantId: '123e4567-e89b-4234-8234-123456789abc',
        event: 'credential-exchange.request-received',
        resourceId: 'exchange-1',
        occurredAt: '2026-11-19T00:00:00.000Z',
      },
    } as Job<WebhookDispatchJobData>;

    await expect(worker.handle(job)).resolves.toBeUndefined();
    expect(registrations.findActiveForDispatch).not.toHaveBeenCalled();
  });

  it('delivers a subscribed event with an HMAC signature and pinned public address', async () => {
    const registration = {
      id: 'registration-1',
      endpointUrl: 'https://hooks.example.com/events',
      events: [WebhookEvent.CREDENTIAL_ISSUED],
      credentialsEncrypted: randomBytes(64),
      keyVersion: 2,
    };
    registrations.findActiveForDispatch.mockResolvedValue([registration]);
    let responseCallback:
      | ((
          response: EventEmitter & { statusCode: number; resume: () => void },
        ) => void)
      | undefined;
    const response = Object.assign(new EventEmitter(), {
      statusCode: 204,
      resume: jest.fn(() => process.nextTick(() => response.emit('end'))),
    });
    const request = Object.assign(new EventEmitter(), {
      end: jest.fn(() => process.nextTick(() => responseCallback?.(response))),
      destroy: jest.fn(),
    });
    jest.mocked(httpsRequest).mockImplementation((_url, _options, callback) => {
      responseCallback = callback as typeof responseCallback;
      return request as unknown as ReturnType<typeof httpsRequest>;
    });
    const job = {
      id: 'delivery-1',
      data: {
        tenantId: '123e4567-e89b-4234-8234-123456789abc',
        event: WebhookEvent.CREDENTIAL_ISSUED,
        resourceId: 'credential-1',
        occurredAt: '2026-11-19T00:00:00.000Z',
      },
    } as Job<WebhookDispatchJobData>;
    const body = JSON.stringify({
      id: job.id,
      tenant_id: job.data.tenantId,
      event: job.data.event,
      resource_id: job.data.resourceId,
      occurred_at: job.data.occurredAt,
    });

    await expect(worker.handle(job)).resolves.toBeUndefined();

    const [url, options] = jest.mocked(httpsRequest).mock.calls[0];
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).href).toBe(registration.endpointUrl);
    expect(options).toMatchObject({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-event': job.data.event,
        'x-webhook-delivery': job.id,
        'x-webhook-signature': `sha256=${createHmac('sha256', signingSecret)
          .update(body, 'utf8')
          .digest('hex')}`,
      },
    });
    expect(options?.agent).toBeInstanceOf(Agent);
    const pinnedLookup = (options?.agent as Agent).options.lookup;
    const lookupResult = jest.fn();
    pinnedLookup?.('hooks.example.com', {}, lookupResult);
    expect(lookupResult).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    expect(request.end).toHaveBeenCalledWith(body);
    expect(assertSafePublicHttpsUrl).toHaveBeenCalledWith(
      registration.endpointUrl,
      'Webhook endpoint',
    );
    expect(encryption.decrypt).toHaveBeenCalledWith(
      registration.credentialsEncrypted,
      registration.keyVersion,
    );
  });

  it('rejects a payload with a non-uuid tenantId', async () => {
    const job = {
      id: 'job-1',
      data: {
        tenantId: 'not-a-uuid',
        event: 'credential.issued',
        resourceId: 'ext-1',
        occurredAt: '2024-01-01T00:00:00.000Z',
      },
    } as Job<WebhookDispatchJobData>;

    await expect(worker.handle(job)).rejects.toThrow(
      'Invalid webhook.dispatch payload',
    );
  });

  it('rejects a payload missing required fields', async () => {
    const job = {
      id: 'job-1',
      data: {
        tenantId: '123e4567-e89b-12d3-a456-426614174001',
        event: '',
        resourceId: 'ext-1',
        occurredAt: '2024-01-01T00:00:00.000Z',
      },
    } as Job<WebhookDispatchJobData>;

    await expect(worker.handle(job)).rejects.toThrow(
      'Invalid webhook.dispatch payload',
    );
  });

  it('enqueues a webhook.dispatch job', async () => {
    const data: WebhookDispatchJobData = {
      tenantId: '123e4567-e89b-12d3-a456-426614174001',
      event: 'credential.issued',
      resourceId: 'ext-1',
      occurredAt: '2024-01-01T00:00:00.000Z',
    };

    await worker.enqueue(data);

    expect(mockPublish).toHaveBeenCalledWith('webhook.dispatch', data);
  });
});
