import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Job } from 'pg-boss';

import { JobsService } from '../jobs/jobs.service';

import {
  WebhookDispatchJobData,
  WebhookDispatchWorker,
} from './webhook-dispatch.worker';

describe('WebhookDispatchWorker', () => {
  let worker: WebhookDispatchWorker;
  let mockRegisterWorker: jest.Mock;
  let mockPublish: jest.Mock;

  beforeEach(async () => {
    mockRegisterWorker = jest.fn().mockResolvedValue('worker-1');
    mockPublish = jest.fn().mockResolvedValue('job-1');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookDispatchWorker,
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

  it('acknowledges a valid job without throwing', async () => {
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
