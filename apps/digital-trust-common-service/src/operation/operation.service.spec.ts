import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

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

    const mockRepository = {
      create: mockCreate,
      save: mockSave,
      findById: mockFindById,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OperationService,
        {
          provide: OperationRepository,
          useValue: mockRepository,
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

      expect(result.viewedAt).toEqual(viewedAt);
      expect(result.expiresAt.getTime()).toBe(viewedAt.getTime() + 1 * HOUR_MS);
      expect(mockSave).toHaveBeenCalledTimes(1);
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
