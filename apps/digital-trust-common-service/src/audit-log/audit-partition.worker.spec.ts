import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { Job } from 'pg-boss';

import { JobsService } from '../jobs/jobs.service';

import {
  AuditPartitionMaintainJobData,
  AuditPartitionWorker,
} from './audit-partition.worker';

describe('AuditPartitionWorker', () => {
  let worker: AuditPartitionWorker;
  let mockRegisterWorker: jest.Mock;
  let mockSchedule: jest.Mock;
  let mockPublish: jest.Mock;
  let mockQuery: jest.Mock;

  beforeEach(async () => {
    mockRegisterWorker = jest.fn().mockResolvedValue('worker-1');
    mockSchedule = jest.fn().mockResolvedValue(undefined);
    mockPublish = jest.fn().mockResolvedValue('job-1');
    mockQuery = jest.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditPartitionWorker,
        {
          provide: JobsService,
          useValue: {
            registerWorker: mockRegisterWorker,
            schedule: mockSchedule,
            publish: mockPublish,
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((_key: string, fallback?: string) => fallback),
          },
        },
        {
          provide: getDataSourceToken(),
          useValue: { query: mockQuery },
        },
      ],
    }).compile();

    worker = module.get(AuditPartitionWorker);
  });

  it('registers worker, schedules cron, and enqueues a startup job', async () => {
    await worker.onModuleInit();

    expect(mockRegisterWorker).toHaveBeenCalledWith(
      'audit.partition-maintain',
      expect.any(Function),
      { enabled: true },
    );
    expect(mockSchedule).toHaveBeenCalledWith(
      'audit.partition-maintain',
      '0 3 * * *',
      {},
    );
    expect(mockPublish).toHaveBeenCalledWith('audit.partition-maintain', {});
  });

  it('creates monthly partitions for current + monthsAhead', async () => {
    const job = {
      id: 'job-1',
      data: { monthsAhead: 1 },
    } as Job<AuditPartitionMaintainJobData>;

    await worker.handle(job);

    // current month + 1 ahead = 2 partitions
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS'),
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('PARTITION OF audit_log'),
    );
  });

  it('falls back to default monthsAhead when value is invalid', async () => {
    const job = {
      id: 'job-2',
      data: { monthsAhead: Number.NaN },
    } as Job<AuditPartitionMaintainJobData>;

    await worker.handle(job);

    // default monthsAhead=3 → current + 3 = 4 partitions
    expect(mockQuery).toHaveBeenCalledTimes(4);
  });
});
