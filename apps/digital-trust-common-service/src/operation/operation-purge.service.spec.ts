import { PgBossService } from '@app/pg-boss';
import { Test, TestingModule } from '@nestjs/testing';

import {
  OPERATION_PURGE_QUEUE,
  OperationPurgeService,
} from './operation-purge.service';
import { OperationRepository, PurgeTenantCount } from './operation.repository';

describe('OperationPurgeService', () => {
  let service: OperationPurgeService;
  let mockPurgeExpiredBatch: jest.Mock;
  let mockCreateQueue: jest.Mock;
  let mockSchedule: jest.Mock;
  let mockWork: jest.Mock;
  let bossService: PgBossService;

  beforeEach(async () => {
    mockPurgeExpiredBatch = jest.fn();
    mockCreateQueue = jest.fn().mockResolvedValue(undefined);
    mockSchedule = jest.fn().mockResolvedValue(undefined);
    mockWork = jest.fn().mockResolvedValue('worker-id');

    const mockOperationRepository = {
      purgeExpiredBatch: mockPurgeExpiredBatch,
    };

    const mockBossService = {
      boss: {
        createQueue: mockCreateQueue,
        schedule: mockSchedule,
        work: mockWork,
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OperationPurgeService,
        {
          provide: OperationRepository,
          useValue: mockOperationRepository,
        },
        {
          provide: PgBossService,
          useValue: mockBossService,
        },
      ],
    }).compile();

    service = module.get<OperationPurgeService>(OperationPurgeService);
    bossService = module.get<PgBossService>(PgBossService);
  });

  describe('onModuleInit', () => {
    it('creates the queue, schedules the hourly cron, and registers the worker', async () => {
      await service.onModuleInit();

      expect(mockCreateQueue).toHaveBeenCalledWith(OPERATION_PURGE_QUEUE, {
        policy: 'exclusive',
      });
      expect(mockSchedule).toHaveBeenCalledWith(
        OPERATION_PURGE_QUEUE,
        '0 * * * *',
      );
      expect(mockWork).toHaveBeenCalledWith(
        OPERATION_PURGE_QUEUE,
        expect.any(Function),
      );
    });

    it('the registered worker invokes purgeExpiredOperations', async () => {
      mockPurgeExpiredBatch.mockResolvedValue([]);
      await service.onModuleInit();

      const [, handler] = mockWork.mock.calls[0] as [
        string,
        () => Promise<void>,
      ];
      await handler();

      expect(mockPurgeExpiredBatch).toHaveBeenCalled();
    });
  });

  describe('purgeExpiredOperations', () => {
    it('does nothing further when there is nothing to purge', async () => {
      mockPurgeExpiredBatch.mockResolvedValue([]);

      await service.purgeExpiredOperations();

      expect(mockPurgeExpiredBatch).toHaveBeenCalledTimes(1);
    });

    it('loops until a batch returns no rows, aggregating counts per tenant', async () => {
      const batch1: PurgeTenantCount[] = [
        { tenantId: 't1', count: 500 },
        { tenantId: 't2', count: 200 },
      ];
      const batch2: PurgeTenantCount[] = [{ tenantId: 't1', count: 50 }];
      const empty: PurgeTenantCount[] = [];

      mockPurgeExpiredBatch
        .mockResolvedValueOnce(batch1)
        .mockResolvedValueOnce(batch2)
        .mockResolvedValueOnce(empty);

      await service.purgeExpiredOperations();

      expect(mockPurgeExpiredBatch).toHaveBeenCalledTimes(3);
    });

    it('stops after the max-batches-per-run safety cap even if rows remain', async () => {
      mockPurgeExpiredBatch.mockResolvedValue([{ tenantId: 't1', count: 500 }]);

      await service.purgeExpiredOperations();

      expect(mockPurgeExpiredBatch).toHaveBeenCalledTimes(50);
    });

    it('propagates errors from a failing batch delete', async () => {
      mockPurgeExpiredBatch.mockRejectedValue(new Error('db unavailable'));

      await expect(service.purgeExpiredOperations()).rejects.toThrow(
        'db unavailable',
      );
    });
  });

  it('is defined', () => {
    expect(service).toBeDefined();
    expect(bossService).toBeDefined();
  });
});
