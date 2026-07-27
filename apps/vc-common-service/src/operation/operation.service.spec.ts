import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

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
  let mockTenantFindById: jest.Mock;

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
    mockTenantFindById = jest.fn();
    mockTenantFindById.mockResolvedValue({ id: 't1', config: {} });

    const mockRepository = {
      create: mockCreate,
      save: mockSave,
      findById: mockFindById,
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
    it('creates a pending operation with a 72h expiry', async () => {
      jest.useFakeTimers().setSystemTime(createdAt);
      const created = buildOperation();
      mockCreate.mockReturnValue(created);
      mockSave.mockResolvedValue(created);

      const result = await service.createOperation({
        tenantId: 't1',
        type: 'credential.offer',
        request: baseRequest,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 't1',
          type: 'credential.offer',
          request: baseRequest,
          batchId: null,
          externalId: null,
          state: OperationState.PENDING,
          expiresAt: new Date(createdAt.getTime() + 72 * HOUR_MS),
        }),
      );
      expect(result).toBe(created);
    });

    it('ignores the tenant completed_unviewed TTL override at creation (it only applies once completed and unviewed)', async () => {
      jest.useFakeTimers().setSystemTime(createdAt);
      mockTenantFindById.mockResolvedValue({
        id: 't1',
        config: { operation_ttl: { completed_unviewed: '2h' } },
      });
      const created = buildOperation();
      mockCreate.mockReturnValue(created);
      mockSave.mockResolvedValue(created);

      await service.createOperation({
        tenantId: 't1',
        type: 'credential.offer',
        request: baseRequest,
      });

      expect(mockTenantFindById).not.toHaveBeenCalled();
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          expiresAt: new Date(createdAt.getTime() + 72 * HOUR_MS),
        }),
      );
    });
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
      mockSave.mockImplementation((op: Operation) => Promise.resolve(op));

      const result = await service.markViewed('op-1');

      expect(mockTenantFindById).toHaveBeenCalledWith('t1');
      expect(result.viewedAt).toEqual(viewedAt);
      expect(result.expiresAt.getTime()).toBe(viewedAt.getTime() + 1 * HOUR_MS);
      expect(mockSave).toHaveBeenCalledTimes(1);
    });

    it('applies the tenant completed_viewed TTL override', async () => {
      jest.useFakeTimers().setSystemTime(viewedAt);
      mockTenantFindById.mockResolvedValue({
        id: 't1',
        config: { operation_ttl: { completed_viewed: '15m' } },
      });
      const operation = buildOperation({ state: OperationState.COMPLETED });
      mockFindById.mockResolvedValue(operation);
      mockSave.mockImplementation((op: Operation) => Promise.resolve(op));

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
      expect(mockSave).not.toHaveBeenCalled();
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
  });
});
