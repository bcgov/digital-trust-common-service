import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Job } from 'pg-boss';

import { JobsService } from '../jobs/jobs.service';

import { RateLimitHitRepository } from './rate-limit-hit.repository';
import {
  RateLimitPruneJobData,
  RateLimitPruneWorker,
} from './rate-limit-prune.worker';

describe('RateLimitPruneWorker', () => {
  let worker: RateLimitPruneWorker;
  let mockRegisterWorker: jest.Mock;
  let mockSchedule: jest.Mock;
  let mockPruneOlderThan: jest.Mock;

  beforeEach(async () => {
    mockRegisterWorker = jest.fn().mockResolvedValue('worker-1');
    mockSchedule = jest.fn().mockResolvedValue(undefined);
    mockPruneOlderThan = jest.fn().mockResolvedValue(3);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitPruneWorker,
        {
          provide: JobsService,
          useValue: {
            registerWorker: mockRegisterWorker,
            schedule: mockSchedule,
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((_key: string, fallback?: string) => fallback),
          },
        },
        {
          provide: RateLimitHitRepository,
          useValue: { pruneOlderThan: mockPruneOlderThan },
        },
      ],
    }).compile();

    worker = module.get(RateLimitPruneWorker);
  });

  it('registers the worker and schedules the hourly cron', async () => {
    await worker.onModuleInit();

    expect(mockRegisterWorker).toHaveBeenCalledWith(
      'rate-limit.prune',
      expect.any(Function),
      { enabled: true },
    );
    expect(mockSchedule).toHaveBeenCalledWith(
      'rate-limit.prune',
      '0 * * * *',
      {},
    );
  });

  it('skips scheduling when workers are disabled', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitPruneWorker,
        {
          provide: JobsService,
          useValue: {
            registerWorker: mockRegisterWorker,
            schedule: mockSchedule,
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: string) =>
              key === 'PG_BOSS_WORKERS_ENABLED' ? 'false' : fallback,
            ),
          },
        },
        {
          provide: RateLimitHitRepository,
          useValue: { pruneOlderThan: mockPruneOlderThan },
        },
      ],
    }).compile();

    const disabledWorker = module.get(RateLimitPruneWorker);
    await disabledWorker.onModuleInit();

    expect(mockRegisterWorker).toHaveBeenCalled();
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  describe('handle', () => {
    it('prunes hits older than the configured retention window', async () => {
      await worker.handle({} as Job<RateLimitPruneJobData>);

      expect(mockPruneOlderThan).toHaveBeenCalledWith(expect.any(Date));
    });

    it('falls back to 5 minutes when retention is not a positive number', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RateLimitPruneWorker,
          { provide: JobsService, useValue: {} },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) =>
                key === 'RATE_LIMIT_HIT_RETENTION_MINUTES' ? '-1' : undefined,
              ),
            },
          },
          {
            provide: RateLimitHitRepository,
            useValue: { pruneOlderThan: mockPruneOlderThan },
          },
        ],
      }).compile();

      const invalidWorker = module.get(RateLimitPruneWorker);
      const before = Date.now();
      await invalidWorker.handle({} as Job<RateLimitPruneJobData>);

      const [cutoff]: [Date] = mockPruneOlderThan.mock.calls[0] as unknown as [
        Date,
      ];
      expect(before - cutoff.getTime()).toBeGreaterThanOrEqual(4 * 60 * 1000);
      expect(before - cutoff.getTime()).toBeLessThanOrEqual(6 * 60 * 1000);
    });
  });
});
