import { PgBossService } from '@app/pg-boss';
import { Test, TestingModule } from '@nestjs/testing';

import {
  ExpiredSessionWithUpstreamCleanup,
  OidcPurgeRepository,
  PurgeModelCount,
} from './oidc-purge.repository';
import { OIDC_PURGE_QUEUE, OidcPurgeService } from './oidc-purge.service';
import { OIDC_UPSTREAM_FEDERATION_PORT } from './ports/oidc-upstream-federation.port';

describe('OidcPurgeService', () => {
  let service: OidcPurgeService;
  let mockPurgeExpiredBatch: jest.Mock;
  let mockPurgeExpiredUpstreamBatch: jest.Mock;
  let mockGetExpiredSessionsWithUpstreamCleanup: jest.Mock;
  let mockLogoutUpstreamSessionForOidcSession: jest.Mock;
  let mockDeleteExpiredPendingSessionBatch: jest.Mock;
  let mockCreateQueue: jest.Mock;
  let mockSchedule: jest.Mock;
  let mockWork: jest.Mock;

  beforeEach(async () => {
    mockPurgeExpiredBatch = jest.fn();
    mockPurgeExpiredUpstreamBatch = jest.fn();
    mockGetExpiredSessionsWithUpstreamCleanup = jest.fn().mockResolvedValue([]);
    mockLogoutUpstreamSessionForOidcSession = jest
      .fn()
      .mockResolvedValue(undefined);
    mockDeleteExpiredPendingSessionBatch = jest.fn().mockResolvedValue(0);
    mockCreateQueue = jest.fn().mockResolvedValue(undefined);
    mockSchedule = jest.fn().mockResolvedValue(undefined);
    mockWork = jest.fn().mockResolvedValue('worker-id');

    const mockPurgeRepository = {
      purgeExpiredBatch: mockPurgeExpiredBatch,
      purgeExpiredUpstreamInteractionsBatch: mockPurgeExpiredUpstreamBatch,
      getExpiredSessionsWithUpstreamCleanup:
        mockGetExpiredSessionsWithUpstreamCleanup,
    };

    const mockUpstreamFederation = {
      logoutUpstreamSessionForOidcSession:
        mockLogoutUpstreamSessionForOidcSession,
      deleteExpiredPendingSessionBatch: mockDeleteExpiredPendingSessionBatch,
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
          provide: OIDC_UPSTREAM_FEDERATION_PORT,
          useValue: mockUpstreamFederation,
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
      expect(mockGetExpiredSessionsWithUpstreamCleanup).toHaveBeenCalled();
      expect(mockDeleteExpiredPendingSessionBatch).toHaveBeenCalled();
    });
  });

  describe('purgeExpiredModels', () => {
    it('does nothing further when there is nothing to purge', async () => {
      mockPurgeExpiredBatch.mockResolvedValue([]);
      mockPurgeExpiredUpstreamBatch.mockResolvedValue({ count: 0 });

      await service.purgeExpiredModels();

      expect(mockPurgeExpiredBatch).toHaveBeenCalledTimes(1);
      expect(mockPurgeExpiredUpstreamBatch).toHaveBeenCalledTimes(1);
      expect(mockGetExpiredSessionsWithUpstreamCleanup).toHaveBeenCalledTimes(
        1,
      );
      expect(mockDeleteExpiredPendingSessionBatch).toHaveBeenCalledTimes(1);
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
      expect(mockGetExpiredSessionsWithUpstreamCleanup).toHaveBeenCalledTimes(
        3,
      );
      expect(mockDeleteExpiredPendingSessionBatch).toHaveBeenCalledTimes(3);
    });

    it('stops after the max-batches-per-run safety cap even if rows remain', async () => {
      mockPurgeExpiredBatch.mockResolvedValue([
        { modelName: 'AccessToken', count: 500 },
      ]);
      mockPurgeExpiredUpstreamBatch.mockResolvedValue({ count: 100 });

      await service.purgeExpiredModels();

      expect(mockPurgeExpiredBatch).toHaveBeenCalledTimes(50);
      expect(mockPurgeExpiredUpstreamBatch).toHaveBeenCalledTimes(50);
      expect(mockGetExpiredSessionsWithUpstreamCleanup).toHaveBeenCalledTimes(
        50,
      );
      expect(mockDeleteExpiredPendingSessionBatch).toHaveBeenCalledTimes(50);
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

    it('logs out each expired session that has an upstream federation link before purging', async () => {
      const sessions: ExpiredSessionWithUpstreamCleanup[] = [
        { oidcModelId: 'model-1', oidcSessionUid: 'session-uid-1' },
        { oidcModelId: 'model-2', oidcSessionUid: null },
      ];
      mockGetExpiredSessionsWithUpstreamCleanup.mockResolvedValueOnce(sessions);
      mockPurgeExpiredBatch.mockResolvedValue([]);
      mockPurgeExpiredUpstreamBatch.mockResolvedValue({ count: 0 });

      await service.purgeExpiredModels();

      expect(mockGetExpiredSessionsWithUpstreamCleanup).toHaveBeenCalledWith(
        500,
      );
      expect(mockLogoutUpstreamSessionForOidcSession).toHaveBeenCalledTimes(2);
      expect(mockLogoutUpstreamSessionForOidcSession).toHaveBeenNthCalledWith(
        1,
        { oidcModelId: 'model-1', oidcSessionUid: 'session-uid-1' },
      );
      expect(mockLogoutUpstreamSessionForOidcSession).toHaveBeenNthCalledWith(
        2,
        { oidcModelId: 'model-2', oidcSessionUid: null },
      );
    });

    it('logs a warning and continues when an upstream logout fails for one session', async () => {
      const sessions: ExpiredSessionWithUpstreamCleanup[] = [
        { oidcModelId: 'model-1', oidcSessionUid: 'session-uid-1' },
        { oidcModelId: 'model-2', oidcSessionUid: 'session-uid-2' },
      ];
      mockGetExpiredSessionsWithUpstreamCleanup.mockResolvedValueOnce(sessions);
      mockLogoutUpstreamSessionForOidcSession
        .mockRejectedValueOnce(new Error('upstream unreachable'))
        .mockResolvedValueOnce(undefined);
      mockPurgeExpiredBatch.mockResolvedValue([]);
      mockPurgeExpiredUpstreamBatch.mockResolvedValue({ count: 0 });

      await service.purgeExpiredModels();

      expect(mockLogoutUpstreamSessionForOidcSession).toHaveBeenCalledTimes(2);
      expect(mockPurgeExpiredBatch).toHaveBeenCalledTimes(1);
    });

    it('deletes expired pending upstream sessions each batch', async () => {
      mockDeleteExpiredPendingSessionBatch.mockResolvedValueOnce(3);
      mockPurgeExpiredBatch.mockResolvedValue([]);
      mockPurgeExpiredUpstreamBatch.mockResolvedValue({ count: 0 });

      await service.purgeExpiredModels();

      expect(mockDeleteExpiredPendingSessionBatch).toHaveBeenCalledWith(500);
    });

    it('propagates errors from a failing upstream session lookup', async () => {
      const error = new Error('upstream lookup failed');
      mockGetExpiredSessionsWithUpstreamCleanup.mockRejectedValue(error);

      await expect(service.purgeExpiredModels()).rejects.toThrow(
        'upstream lookup failed',
      );
      expect(mockPurgeExpiredBatch).not.toHaveBeenCalled();
    });
  });
});
