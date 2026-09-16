import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Job } from 'pg-boss';

import { JobsService } from '../jobs/jobs.service';

import { ProtocolStateChangeService } from './protocol-state-change.service';
import {
  ProtocolStateChangeJobData,
  ProtocolStateChangeWorker,
} from './protocol-state-change.worker';

describe('ProtocolStateChangeWorker', () => {
  let worker: ProtocolStateChangeWorker;
  let mockRegisterWorker: jest.Mock;
  let mockPublish: jest.Mock;
  let mockProcess: jest.Mock;

  beforeEach(async () => {
    mockRegisterWorker = jest.fn().mockResolvedValue('worker-1');
    mockPublish = jest.fn().mockResolvedValue('job-1');
    mockProcess = jest.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProtocolStateChangeWorker,
        {
          provide: JobsService,
          useValue: {
            registerWorker: mockRegisterWorker,
            publish: mockPublish,
          },
        },
        {
          provide: ProtocolStateChangeService,
          useValue: { process: mockProcess },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((_key: string, fallback?: string) => fallback),
          },
        },
      ],
    }).compile();

    worker = module.get(ProtocolStateChangeWorker);
  });

  it('registers the protocol.state-change worker with batchSize 5 on init', async () => {
    await worker.onModuleInit();

    expect(mockRegisterWorker).toHaveBeenCalledWith(
      'protocol.state-change',
      expect.any(Function),
      { enabled: true, batchSize: 5 },
    );
  });

  it('delegates a valid job payload to the service', async () => {
    const job = {
      id: 'job-1',
      data: {
        tenantId: '123e4567-e89b-12d3-a456-426614174001',
        topic: 'issue_credential',
        externalId: 'ext-1',
        protocolState: 'credential-issued',
        payload: {},
      },
    } as Job<ProtocolStateChangeJobData>;

    await worker.handle(job);

    expect(mockProcess).toHaveBeenCalledWith(job.data);
  });

  it('rejects a payload with an unknown topic', async () => {
    const job = {
      id: 'job-1',
      data: {
        tenantId: '123e4567-e89b-12d3-a456-426614174001',
        topic: 'not_a_topic',
        externalId: 'ext-1',
        protocolState: 'credential-issued',
        payload: {},
      },
    } as unknown as Job<ProtocolStateChangeJobData>;

    await expect(worker.handle(job)).rejects.toThrow(
      'Invalid protocol.state-change payload',
    );
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it('rejects a payload with a non-uuid tenantId', async () => {
    const job = {
      id: 'job-1',
      data: {
        tenantId: 'not-a-uuid',
        topic: 'issue_credential',
        externalId: 'ext-1',
        protocolState: 'credential-issued',
        payload: {},
      },
    } as Job<ProtocolStateChangeJobData>;

    await expect(worker.handle(job)).rejects.toThrow(
      'Invalid protocol.state-change payload',
    );
  });

  it('rejects a payload missing required fields', async () => {
    const job = {
      id: 'job-1',
      data: {
        tenantId: '123e4567-e89b-12d3-a456-426614174001',
        topic: 'issue_credential',
        externalId: '',
        protocolState: 'credential-issued',
        payload: {},
      },
    } as Job<ProtocolStateChangeJobData>;

    await expect(worker.handle(job)).rejects.toThrow(
      'Invalid protocol.state-change payload',
    );
  });

  it('enqueues a protocol.state-change job', async () => {
    const data: ProtocolStateChangeJobData = {
      tenantId: '123e4567-e89b-12d3-a456-426614174001',
      topic: 'connections',
      externalId: 'ext-1',
      protocolState: 'active',
      payload: {},
    };

    await worker.enqueue(data);

    expect(mockPublish).toHaveBeenCalledWith('protocol.state-change', data);
  });
});
