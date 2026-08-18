import { PgBossService } from '@app/pg-boss';
import { Test, TestingModule } from '@nestjs/testing';

import { OidcPurgeRepository, PurgeModelCount } from './oidc-purge.repository';
import { OIDC_PURGE_QUEUE, OidcPurgeService } from './oidc-purge.service';

describe('OidcPurgeService', () => {
  let service: OidcPurgeService;
  let mockPurgeExpiredBatch: jest.Mock;
  let mockPurgeExpiredUpstreamBatch: jest.Mock;
  let mockCreateQueue: jest.Mock;
  let mockSchedule: jest.Mock;
  let mockWork: jest.Mock;

  beforeEach(async () => {
    mockPurgeExpiredBatch = jest.fn();
    mockPurgeExpiredUpstreamBatch = jest.fn();
    mockCreateQueue = jest.fn().mockResolvedValue(undefined);
    mockSchedule = jest.fn().mockResolvedValue(undefined);
    mockWork = jest.fn().mockResolvedValue('worker-id');

    const mockPurgeRepository = {
      purgeExpiredBatch: mockPurgeExpiredBatch,
      purgeExpiredUpstreamInteractionsBatch: mockPurgeExpiredUpstreamBatch,
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
        OidcPurgeService,
        {
          provide: OidcPurgeRepository,
          useValue: mockPurgeRepository,
        },
        {
          provide: PgBossService,
          useValue: mockBossService,
        },
      ],
    }).compile();

    service = module.get<OidcPurgeService>(OidcPurgeService);
  });

  describe('onModuleInit', () => {
    it('creates the queue, schedules the hourly cron, and registers the worker', async () => {
      await service.onModuleInit();

      expect(mockCreateQueue).toHaveBeenCalledWith(OIDC_PURGE_QUEUE, {
        policy: 'exclusive',
      });
      expect(mockSchedule).toHaveBeenCalledWith(OIDC_PURGE_QUEUE, '0 * * * *');
      expect(mockWork).toHaveBeenCalledWith(
        OIDC_PURGE_QUEUE,
        expect.any(Function),
      );
    });

    it('the registered worker invokes purgeExpiredModels', async () => {
      mockPurgeExpiredBatch.mockResolvedValue([]);
      mockPurgeExpiredUpstreamBatch.mockResolvedValue({ count: 0 });
      await service.onModuleInit();

      const [, handler] = mockWork.mock.calls[0] as [
        string,
        () => Promise<void>,
      ];
      await handler();

      expect(mockPurgeExpiredBatch).toHaveBeenCalled();
      expect(mockPurgeExpiredUpstreamBatch).toHaveBeenCalled();
    });
  });

  describe('purgeExpiredModels', () => {
    it('does nothing further when there is nothing to purge', async () => {
      mockPurgeExpiredBatch.mockResolvedValue([]);
      mockPurgeExpiredUpstreamBatch.mockResolvedValue({ count: 0 });

      await service.purgeExpiredModels();

      expect(mockPurgeExpiredBatch).toHaveBeenCalledTimes(1);
      expect(mockPurgeExpiredUpstreamBatch).toHaveBeenCalledTimes(1);
    });

    it('loops until a batch returns no rows, aggregating counts per model kind and interactions', async () => {
      const batch1: PurgeModelCount[] = [
        { modelName: 'AccessToken', count: 500 },
        { modelName: 'RefreshToken', count: 200 },
      ];
      const batch2: PurgeModelCount[] = [
        { modelName: 'AccessToken', count: 50 },
      ];
      const empty: PurgeModelCount[] = [];

      mockPurgeExpiredBatch
        .mockResolvedValueOnce(batch1)
        .mockResolvedValueOnce(batch2)
        .mockResolvedValueOnce(empty);

      mockPurgeExpiredUpstreamBatch
        .mockResolvedValueOnce({ count: 100 })
        .mockResolvedValueOnce({ count: 50 })
        .mockResolvedValueOnce({ count: 0 });

      await service.purgeExpiredModels();

      expect(mockPurgeExpiredBatch).toHaveBeenCalledTimes(3);
      expect(mockPurgeExpiredUpstreamBatch).toHaveBeenCalledTimes(3);
    });

    it('stops after the max-batches-per-run safety cap even if rows remain', async () => {
      mockPurgeExpiredBatch.mockResolvedValue([
        { modelName: 'AccessToken', count: 500 },
      ]);
      mockPurgeExpiredUpstreamBatch.mockResolvedValue({ count: 100 });

      await service.purgeExpiredModels();

      expect(mockPurgeExpiredBatch).toHaveBeenCalledTimes(50);
      expect(mockPurgeExpiredUpstreamBatch).toHaveBeenCalledTimes(50);
    });

    it('propagates errors from a failing batch delete', async () => {
      const error = new Error('db down');
      mockPurgeExpiredBatch.mockRejectedValue(error);

      await expect(service.purgeExpiredModels()).rejects.toThrow('db down');
      expect(mockPurgeExpiredBatch).toHaveBeenCalledTimes(1);
    });

    it('purges both model and upstream interaction records and reports totals', async () => {
      mockPurgeExpiredBatch.mockResolvedValue([
        { modelName: 'AccessToken', count: 100 },
      ]);
      mockPurgeExpiredUpstreamBatch.mockResolvedValue({ count: 25 });

      await service.purgeExpiredModels();

      expect(mockPurgeExpiredBatch).toHaveBeenCalledWith(500);
      expect(mockPurgeExpiredUpstreamBatch).toHaveBeenCalledWith(500);
    });
  });
});
