import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { EntityManager } from 'typeorm';

import {
  BusinessMetricsService,
  UNCLASSIFIED_LABEL,
} from '../common/telemetry/business-metrics.service';
import { TenantService } from '../tenant/tenant.service';

import {
  Operation,
  OperationRequest,
  OperationState,
} from './operation.entity';
import { OperationRepository } from './operation.repository';
import { OperationService } from './operation.service';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe('OperationService', () => {
  let service: OperationService;
  let mockCreate: jest.Mock;
  let mockSave: jest.Mock;
  let mockFindById: jest.Mock;
  let mockFindByIdForTenant: jest.Mock;
  let mockMarkFirstView: jest.Mock;
  let mockTenantFindById: jest.Mock;
  let mockTransitionIfForward: jest.Mock;
  let mockRecordCredentialOperation: jest.Mock;

  const createdAt = new Date('2024-01-01T00:00:00.000Z');
  const viewedAt = new Date('2024-01-02T00:00:00.000Z');

  const baseRequest: OperationRequest = {
    method: 'POST',
    path: '/api/v1/tenants/t1/credentials/offer',
    body: { name: 'Ada' },
  };

  const buildOperation = (overrides: Partial<Operation> = {}): Operation =>
    ({
      id: 'op-1',
      tenantId: 't1',
      batchId: null,
      type: 'credential.offer',
      state: OperationState.PENDING,
      request: baseRequest,
      result: null,
      externalId: null,
      viewedAt: null,
      expiresAt: new Date(createdAt.getTime() + 72 * HOUR_MS),
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    }) as Operation;

  beforeEach(async () => {
    mockCreate = jest.fn();
    mockSave = jest.fn();
    mockFindById = jest.fn();
    mockFindByIdForTenant = jest.fn();
    mockMarkFirstView = jest.fn();
    mockTenantFindById = jest.fn();
    mockTransitionIfForward = jest.fn();
    mockRecordCredentialOperation = jest.fn();
    mockTenantFindById.mockResolvedValue({ id: 't1', config: {} });

    const mockRepository = {
      create: mockCreate,
      save: mockSave,
      findById: mockFindById,
      findByIdForTenant: mockFindByIdForTenant,
      markFirstView: mockMarkFirstView,
      transitionIfForward: mockTransitionIfForward,
    };

    const mockTenantService = {
      findById: mockTenantFindById,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OperationService,
        {
          provide: OperationRepository,
          useValue: mockRepository,
        },
        {
          provide: TenantService,
          useValue: mockTenantService,
        },
        {
          provide: BusinessMetricsService,
          useValue: {
            recordCredentialOperation: mockRecordCredentialOperation,
          },
        },
      ],
    }).compile();

    service = module.get<OperationService>(OperationService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('computeExpiresAt', () => {
    it('pending → createdAt + 24h', () => {
      expect(
        service.computeExpiresAt(OperationState.PENDING, createdAt).getTime(),
      ).toBe(createdAt.getTime() + 24 * HOUR_MS);
    });

    it('processing → createdAt + 72h', () => {
      expect(
        service
          .computeExpiresAt(OperationState.PROCESSING, createdAt)
          .getTime(),
      ).toBe(createdAt.getTime() + 72 * HOUR_MS);
    });

    it('processing ignores viewedAt (not shortened by viewing)', () => {
      expect(
        service
          .computeExpiresAt(OperationState.PROCESSING, createdAt, viewedAt)
          .getTime(),
      ).toBe(createdAt.getTime() + 72 * HOUR_MS);
    });

    it('completed + viewed → viewedAt + 1h', () => {
      expect(
        service
          .computeExpiresAt(OperationState.COMPLETED, createdAt, viewedAt)
          .getTime(),
      ).toBe(viewedAt.getTime() + 1 * HOUR_MS);
    });

    it('completed + not viewed → createdAt + 72h', () => {
      expect(
        service.computeExpiresAt(OperationState.COMPLETED, createdAt).getTime(),
      ).toBe(createdAt.getTime() + 72 * HOUR_MS);
    });

    it('failed + viewed → viewedAt + 24h', () => {
      expect(
        service
          .computeExpiresAt(OperationState.FAILED, createdAt, viewedAt)
          .getTime(),
      ).toBe(viewedAt.getTime() + 24 * HOUR_MS);
    });

    it('failed + not viewed → createdAt + 7d', () => {
      expect(
        service.computeExpiresAt(OperationState.FAILED, createdAt).getTime(),
      ).toBe(createdAt.getTime() + 7 * DAY_MS);
    });

    it('applies tenant config overrides for each TTL key', () => {
      const tenantConfig = {
        operation_ttl: {
          completed_viewed: '30m',
          completed_unviewed: '10h',
          failed_viewed: '2h',
          failed_unviewed: '3d',
          pending_stale: '5h',
        },
      };

      expect(
        service
          .computeExpiresAt(
            OperationState.PENDING,
            createdAt,
            null,
            tenantConfig,
          )
          .getTime(),
      ).toBe(createdAt.getTime() + 5 * HOUR_MS);

      expect(
        service
          .computeExpiresAt(
            OperationState.COMPLETED,
            createdAt,
            viewedAt,
            tenantConfig,
          )
          .getTime(),
      ).toBe(viewedAt.getTime() + 30 * 60 * 1000);

      expect(
        service
          .computeExpiresAt(
            OperationState.COMPLETED,
            createdAt,
            null,
            tenantConfig,
          )
          .getTime(),
      ).toBe(createdAt.getTime() + 10 * HOUR_MS);

      expect(
        service
          .computeExpiresAt(
            OperationState.FAILED,
            createdAt,
            viewedAt,
            tenantConfig,
          )
          .getTime(),
      ).toBe(viewedAt.getTime() + 2 * HOUR_MS);

      expect(
        service
          .computeExpiresAt(
            OperationState.FAILED,
            createdAt,
            null,
            tenantConfig,
          )
          .getTime(),
      ).toBe(createdAt.getTime() + 3 * DAY_MS);
    });

    it('falls back to system defaults when a tenant override is invalid', () => {
      const tenantConfig = {
        operation_ttl: { completed_viewed: 'not-a-duration' },
      };

      expect(
        service
          .computeExpiresAt(
            OperationState.COMPLETED,
            createdAt,
            viewedAt,
            tenantConfig,
          )
          .getTime(),
      ).toBe(viewedAt.getTime() + 1 * HOUR_MS);
    });

    it('falls back to system defaults when tenant config has no operation_ttl', () => {
      expect(
        service
          .computeExpiresAt(OperationState.PENDING, createdAt, null, {})
          .getTime(),
      ).toBe(createdAt.getTime() + 24 * HOUR_MS);
    });
  });

  describe('createOperation', () => {
    it('creates a pending operation with the default pending_stale (24h) expiry', async () => {
      jest.useFakeTimers().setSystemTime(createdAt);
      const created = buildOperation({
        expiresAt: new Date(createdAt.getTime() + 24 * HOUR_MS),
      });
      mockCreate.mockReturnValue(created);
      mockSave.mockResolvedValue(created);

      const result = await service.createOperation({
        tenantId: 't1',
        type: 'credential.offer',
        request: baseRequest,
      });

      expect(mockTenantFindById).toHaveBeenCalledWith('t1');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 't1',
          type: 'credential.offer',
          request: baseRequest,
          batchId: null,
          externalId: null,
          state: OperationState.PENDING,
          expiresAt: new Date(createdAt.getTime() + 24 * HOUR_MS),
        }),
      );
      expect(result).toBe(created);
    });

    it('honors the tenant pending_stale TTL override at creation', async () => {
      jest.useFakeTimers().setSystemTime(createdAt);
      mockTenantFindById.mockResolvedValue({
        id: 't1',
        config: { operation_ttl: { pending_stale: '2h' } },
      });
      const created = buildOperation({
        expiresAt: new Date(createdAt.getTime() + 2 * HOUR_MS),
      });
      mockCreate.mockReturnValue(created);
      mockSave.mockResolvedValue(created);

      await service.createOperation({
        tenantId: 't1',
        type: 'credential.offer',
        request: baseRequest,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          expiresAt: new Date(createdAt.getTime() + 2 * HOUR_MS),
        }),
      );
    });

    it('ignores the tenant completed_unviewed TTL override at creation (it only applies once completed and unviewed)', async () => {
      jest.useFakeTimers().setSystemTime(createdAt);
      mockTenantFindById.mockResolvedValue({
        id: 't1',
        config: { operation_ttl: { completed_unviewed: '2h' } },
      });
      const created = buildOperation({
        expiresAt: new Date(createdAt.getTime() + 24 * HOUR_MS),
      });
      mockCreate.mockReturnValue(created);
      mockSave.mockResolvedValue(created);

      await service.createOperation({
        tenantId: 't1',
        type: 'credential.offer',
        request: baseRequest,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          expiresAt: new Date(createdAt.getTime() + 24 * HOUR_MS),
        }),
      );
    });
  });

  describe('getForTenant', () => {
    it('scopes the lookup to the tenant', async () => {
      const operation = buildOperation();
      mockFindByIdForTenant.mockResolvedValue(operation);

      await expect(service.getForTenant('t1', 'op-1')).resolves.toBe(operation);
      expect(mockFindByIdForTenant).toHaveBeenCalledWith('op-1', 't1');
      expect(mockFindById).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an operation owned by another tenant', async () => {
      // The repository filters on tenant_id, so a foreign id looks identical to a
      // missing row — 404, never 403, so ids cannot be probed across tenants.
      mockFindByIdForTenant.mockResolvedValue(null);

      await expect(service.getForTenant('t2', 'op-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('marks a completed operation viewed and shortens expiry on first read', async () => {
      jest.useFakeTimers().setSystemTime(viewedAt);
      const operation = buildOperation({ state: OperationState.COMPLETED });
      mockFindByIdForTenant.mockResolvedValue(operation);
      mockMarkFirstView.mockImplementation(
        (_id: string, seenAt: Date, expiresAt: Date) =>
          Promise.resolve({ viewedAt: seenAt, expiresAt }),
      );

      const result = await service.getForTenant('t1', 'op-1');

      expect(result.viewedAt).toEqual(viewedAt);
      expect(result.expiresAt.getTime()).toBe(viewedAt.getTime() + 1 * HOUR_MS);
      expect(mockMarkFirstView).toHaveBeenCalledTimes(1);
      // The write must not go through save()/update(), which would move
      // updated_at and fake a state change for a client polling that field.
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('marks a failed operation viewed on first read', async () => {
      jest.useFakeTimers().setSystemTime(viewedAt);
      const operation = buildOperation({ state: OperationState.FAILED });
      mockFindByIdForTenant.mockResolvedValue(operation);
      mockMarkFirstView.mockImplementation(
        (_id: string, seenAt: Date, expiresAt: Date) =>
          Promise.resolve({ viewedAt: seenAt, expiresAt }),
      );

      const result = await service.getForTenant('t1', 'op-1');

      expect(result.viewedAt).toEqual(viewedAt);
      expect(result.expiresAt.getTime()).toBe(
        viewedAt.getTime() + 24 * HOUR_MS,
      );
    });

    it('does not re-stamp viewedAt on a subsequent read', async () => {
      const operation = buildOperation({
        state: OperationState.COMPLETED,
        viewedAt,
      });
      mockFindByIdForTenant.mockResolvedValue(operation);

      const result = await service.getForTenant('t1', 'op-1');

      expect(result.viewedAt).toBe(viewedAt);
      expect(mockMarkFirstView).not.toHaveBeenCalled();
    });

    it('returns the winner values when a concurrent poll stamped the view first', async () => {
      // markFirstView is conditional on viewed_at IS NULL, so the loser writes
      // nothing and must not report an expiry the database never stored.
      const operation = buildOperation({ state: OperationState.COMPLETED });
      const winnerViewedAt = new Date(viewedAt.getTime() - 5000);
      mockFindByIdForTenant.mockResolvedValue(operation);
      mockMarkFirstView.mockResolvedValue(null);
      mockFindById.mockResolvedValue(
        buildOperation({
          state: OperationState.COMPLETED,
          viewedAt: winnerViewedAt,
          expiresAt: new Date(winnerViewedAt.getTime() + 1 * HOUR_MS),
        }),
      );

      const result = await service.getForTenant('t1', 'op-1');

      expect(result.viewedAt).toEqual(winnerViewedAt);
      expect(result.expiresAt.getTime()).toBe(
        winnerViewedAt.getTime() + 1 * HOUR_MS,
      );
    });

    it('throws NotFoundException when the row was purged mid-write', async () => {
      // markFirstView also returns null when the row is gone, not only when a
      // concurrent poll won. Serving the copy loaded moments earlier would
      // report an operation that no longer exists.
      mockFindByIdForTenant.mockResolvedValue(
        buildOperation({ state: OperationState.COMPLETED }),
      );
      mockMarkFirstView.mockResolvedValue(null);
      mockFindById.mockResolvedValue(null);

      await expect(service.getForTenant('t1', 'op-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it.each([OperationState.PENDING, OperationState.PROCESSING])(
      'leaves %s operations unviewed (TTL ignores viewedAt for in-flight states)',
      async (state) => {
        const operation = buildOperation({ state });
        mockFindByIdForTenant.mockResolvedValue(operation);

        const result = await service.getForTenant('t1', 'op-1');

        expect(result.viewedAt).toBeNull();
        expect(mockMarkFirstView).not.toHaveBeenCalled();
      },
    );
  });

  describe('markViewed', () => {
    it('throws NotFoundException when the operation is missing', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(service.markViewed('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('sets viewedAt and recomputes expiry on first view', async () => {
      jest.useFakeTimers().setSystemTime(viewedAt);
      const operation = buildOperation({ state: OperationState.COMPLETED });
      mockFindById.mockResolvedValue(operation);
      mockMarkFirstView.mockImplementation(
        (_id: string, seenAt: Date, expiresAt: Date) =>
          Promise.resolve({ viewedAt: seenAt, expiresAt }),
      );

      const result = await service.markViewed('op-1');

      expect(mockTenantFindById).toHaveBeenCalledWith('t1');
      expect(result.viewedAt).toEqual(viewedAt);
      expect(result.expiresAt.getTime()).toBe(viewedAt.getTime() + 1 * HOUR_MS);
      expect(mockMarkFirstView).toHaveBeenCalledTimes(1);
    });

    it('applies the tenant completed_viewed TTL override', async () => {
      jest.useFakeTimers().setSystemTime(viewedAt);
      mockTenantFindById.mockResolvedValue({
        id: 't1',
        config: { operation_ttl: { completed_viewed: '15m' } },
      });
      const operation = buildOperation({ state: OperationState.COMPLETED });
      mockFindById.mockResolvedValue(operation);
      mockMarkFirstView.mockImplementation(
        (_id: string, seenAt: Date, expiresAt: Date) =>
          Promise.resolve({ viewedAt: seenAt, expiresAt }),
      );

      const result = await service.markViewed('op-1');

      expect(result.expiresAt.getTime()).toBe(
        viewedAt.getTime() + 15 * 60 * 1000,
      );
    });

    it('is idempotent when already viewed', async () => {
      const operation = buildOperation({
        state: OperationState.COMPLETED,
        viewedAt,
      });
      mockFindById.mockResolvedValue(operation);

      const result = await service.markViewed('op-1');

      expect(result).toBe(operation);
      expect(mockMarkFirstView).not.toHaveBeenCalled();
    });
  });

  describe('transitionState', () => {
    it('throws NotFoundException when the operation is missing', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(
        service.transitionState('missing', OperationState.COMPLETED),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates state, result and recomputes expiry', async () => {
      const operation = buildOperation();
      mockFindById.mockResolvedValue(operation);
      mockSave.mockImplementation((op: Operation) => Promise.resolve(op));

      const result = await service.transitionState(
        'op-1',
        OperationState.FAILED,
        { code: 'AGENT_ERROR', message: 'boom' },
      );

      expect(result.state).toBe(OperationState.FAILED);
      expect(result.result).toEqual({ code: 'AGENT_ERROR', message: 'boom' });
      // failed + not viewed → createdAt + 7d
      expect(result.expiresAt.getTime()).toBe(createdAt.getTime() + 7 * DAY_MS);
    });

    it('forwards an explicit manager through to the repository save, e.g. inside a caller-owned transaction', async () => {
      const operation = buildOperation();
      mockFindById.mockResolvedValue(operation);
      mockSave.mockImplementation((op: Operation) => Promise.resolve(op));
      const manager = {} as Parameters<OperationService['transitionState']>[3];

      await service.transitionState(
        'op-1',
        OperationState.COMPLETED,
        { id: 'exch-1' },
        manager,
      );

      expect(mockSave).toHaveBeenCalledWith(operation, manager);
    });
  });

  describe('transitionStateIfForward', () => {
    it('throws NotFoundException when the operation is missing', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(
        service.transitionStateIfForward('missing', OperationState.COMPLETED, [
          OperationState.PROCESSING,
        ]),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('performs a guarded write and returns the reloaded operation when it wins', async () => {
      const operation = buildOperation({ state: OperationState.PROCESSING });
      const updatedAt = new Date('2024-01-03T00:00:00.000Z');
      const updated = buildOperation({
        state: OperationState.COMPLETED,
        result: { code: 'OK' },
        updatedAt,
      });
      mockFindById
        .mockResolvedValueOnce(operation)
        .mockResolvedValueOnce(updated);
      mockTransitionIfForward.mockResolvedValue(true);

      const result = await service.transitionStateIfForward(
        'op-1',
        OperationState.COMPLETED,
        [OperationState.PROCESSING],
        { code: 'OK' },
      );

      expect(mockTransitionIfForward).toHaveBeenCalledWith(
        'op-1',
        operation.tenantId,
        [OperationState.PROCESSING],
        {
          state: OperationState.COMPLETED,
          expiresAt: expect.any(Date),
          result: { code: 'OK' },
        },
        undefined,
      );
      // Reloaded rather than mutated in memory, so the caller sees the
      // database's own updated_at rather than the pre-write copy's.
      expect(mockFindById).toHaveBeenNthCalledWith(2, 'op-1', undefined);
      expect(result).toBe(updated);
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('forwards an explicit manager through to the guarded write and the reload, e.g. inside a caller-owned transaction', async () => {
      const operation = buildOperation({ state: OperationState.PROCESSING });
      const updated = buildOperation({ state: OperationState.COMPLETED });
      mockFindById
        .mockResolvedValueOnce(operation)
        .mockResolvedValueOnce(updated);
      mockTransitionIfForward.mockResolvedValue(true);
      const manager = {} as Parameters<
        OperationService['transitionStateIfForward']
      >[4];

      await service.transitionStateIfForward(
        'op-1',
        OperationState.COMPLETED,
        [OperationState.PROCESSING],
        { code: 'OK' },
        manager,
      );

      expect(mockTransitionIfForward).toHaveBeenCalledWith(
        'op-1',
        operation.tenantId,
        [OperationState.PROCESSING],
        {
          state: OperationState.COMPLETED,
          expiresAt: expect.any(Date),
          result: { code: 'OK' },
        },
        manager,
      );
      expect(mockFindById).toHaveBeenNthCalledWith(2, 'op-1', manager);
    });

    it('returns null without mutating the caller-visible state when another delivery already won', async () => {
      const operation = buildOperation({ state: OperationState.PROCESSING });
      mockFindById.mockResolvedValue(operation);
      mockTransitionIfForward.mockResolvedValue(false);

      const result = await service.transitionStateIfForward(
        'op-1',
        OperationState.COMPLETED,
        [OperationState.PROCESSING],
      );

      expect(result).toBeNull();
    });
  });

  describe('business metrics', () => {
    const transitionTo = async (
      state: OperationState,
      type = 'credential.offer',
    ): Promise<void> => {
      mockFindById.mockResolvedValue(buildOperation({ type }));
      mockSave.mockImplementation((op: Operation) => Promise.resolve(op));

      await service.transitionState('op-1', state);
    };

    it.each([
      [OperationState.COMPLETED, 'completed'],
      [OperationState.FAILED, 'failed'],
    ])('counts a transition to %s as its outcome', async (state, outcome) => {
      await transitionTo(state);

      expect(mockRecordCredentialOperation).toHaveBeenCalledTimes(1);
      expect(mockRecordCredentialOperation).toHaveBeenCalledWith(
        'credential.offer',
        outcome,
        undefined,
      );
    });

    it.each([[OperationState.PENDING], [OperationState.PROCESSING]])(
      'does not count a transition to %s, which is not an outcome',
      async (state) => {
        await transitionTo(state);

        expect(mockRecordCredentialOperation).not.toHaveBeenCalled();
      },
    );

    it('buckets an operation type outside the declared set', async () => {
      // `type` is an open varchar, so an unrecognised value must not become
      // its own permanent metric series.
      await transitionTo(OperationState.COMPLETED, 'something.unexpected');

      expect(mockRecordCredentialOperation).toHaveBeenCalledWith(
        UNCLASSIFIED_LABEL,
        'completed',
        undefined,
      );
    });

    it('records the reloaded type when a guarded transition wins', async () => {
      const operation = buildOperation({ state: OperationState.PROCESSING });
      const updated = buildOperation({
        type: 'credential.revoke',
        state: OperationState.FAILED,
      });
      mockFindById
        .mockResolvedValueOnce(operation)
        .mockResolvedValueOnce(updated);
      mockTransitionIfForward.mockResolvedValue(true);

      await service.transitionStateIfForward('op-1', OperationState.FAILED, [
        OperationState.PROCESSING,
      ]);

      expect(mockRecordCredentialOperation).toHaveBeenCalledWith(
        'credential.revoke',
        'failed',
        undefined,
      );
    });

    it('does not count a guarded transition that lost the race', async () => {
      // pg-boss delivers at least once, so the same transition can arrive
      // twice; only the delivery that wins the guarded UPDATE is an outcome.
      mockFindById.mockResolvedValue(
        buildOperation({ state: OperationState.PROCESSING }),
      );
      mockTransitionIfForward.mockResolvedValue(false);

      await service.transitionStateIfForward('op-1', OperationState.COMPLETED, [
        OperationState.PROCESSING,
      ]);

      expect(mockRecordCredentialOperation).not.toHaveBeenCalled();
    });

    it('hands the transaction on so the count waits for the commit', async () => {
      // The transition is not a fact until the caller's transaction commits,
      // and the callers do further work afterwards that can roll it back.
      // BusinessMetricsService holds the record; it can only do that if it is
      // told which transaction the write belongs to.
      const manager = { queryRunner: { isTransactionActive: true } };
      mockFindById.mockResolvedValue(buildOperation());
      mockSave.mockImplementation((op: Operation) => Promise.resolve(op));

      await service.transitionState(
        'op-1',
        OperationState.COMPLETED,
        undefined,
        manager as unknown as EntityManager,
      );

      expect(mockRecordCredentialOperation).toHaveBeenCalledWith(
        'credential.offer',
        'completed',
        manager,
      );
    });

    it('hands the transaction on from a guarded transition too', async () => {
      const manager = { queryRunner: { isTransactionActive: true } };
      mockFindById
        .mockResolvedValueOnce(
          buildOperation({ state: OperationState.PROCESSING }),
        )
        .mockResolvedValueOnce(
          buildOperation({ state: OperationState.COMPLETED }),
        );
      mockTransitionIfForward.mockResolvedValue(true);

      await service.transitionStateIfForward(
        'op-1',
        OperationState.COMPLETED,
        [OperationState.PROCESSING],
        undefined,
        manager as unknown as EntityManager,
      );

      expect(mockRecordCredentialOperation).toHaveBeenCalledWith(
        'credential.offer',
        'completed',
        manager,
      );
    });
  });
});
