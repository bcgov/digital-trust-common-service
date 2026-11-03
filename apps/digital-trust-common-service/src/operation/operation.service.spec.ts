import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { EntityManager } from 'typeorm';

import { AuditAction, AuditActorType } from '../audit-log/audit-log.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { decodeCursor, encodeCursor } from '../common/cursor-pagination';
import {
  BusinessMetricsService,
  UNCLASSIFIED_LABEL,
} from '../common/telemetry/business-metrics.service';
import { TenantService } from '../tenant/tenant.service';

import { OPERATION_TYPE } from './operation-type.constants';
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
  let mockFindPageForTenant: jest.Mock;
  let mockCountByBatch: jest.Mock;
  let mockFindFailedBatchItems: jest.Mock;
  let mockBatchFingerprint: jest.Mock;
  let mockAuditWrite: jest.Mock;

  const requestActor = { sub: 'reader', tokenType: 'user' as const };

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
    mockFindPageForTenant = jest.fn();
    mockCountByBatch = jest.fn();
    mockFindFailedBatchItems = jest.fn();
    mockBatchFingerprint = jest.fn().mockResolvedValue('unchanged');
    mockAuditWrite = jest.fn().mockResolvedValue({});
    mockTenantFindById.mockResolvedValue({ id: 't1', config: {} });

    const mockRepository = {
      create: mockCreate,
      save: mockSave,
      findById: mockFindById,
      findByIdForTenant: mockFindByIdForTenant,
      markFirstView: mockMarkFirstView,
      transitionIfForward: mockTransitionIfForward,
      findPageForTenant: mockFindPageForTenant,
      countByBatchGroupedByState: mockCountByBatch,
      findFailedBatchItemsForTenant: mockFindFailedBatchItems,
      findBatchStateFingerprintForTenant: mockBatchFingerprint,
    };

    const mockTenantService = {
      findById: mockTenantFindById,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OperationService,
        { provide: AuditLogService, useValue: { write: mockAuditWrite } },
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

  describe('tenant read services', () => {
    it('uses shared cursors and forwards tenant list filters', async () => {
      const cursor = {
        createdAt: createdAt.toISOString(),
        id: '123e4567-e89b-42d3-a456-426614174002',
      };
      const item = buildOperation();
      mockFindPageForTenant.mockResolvedValue({
        items: [item],
        nextCursor: cursor,
        hasMore: true,
      });

      const page = await service.listForTenant('t1', {
        cursor: encodeCursor(cursor),
        type: 'credential.offer',
        state: OperationState.PENDING,
        limit: 1,
      });

      expect(mockFindPageForTenant).toHaveBeenCalledWith({
        tenantId: 't1',
        cursor,
        type: 'credential.offer',
        state: OperationState.PENDING,
        limit: 1,
      });
      expect(page.data).toEqual([item]);
      expect(decodeCursor(page.pagination.next_cursor!)).toEqual(cursor);
      expect(page.pagination.has_more).toBe(true);
    });

    it('rejects malformed cursors before querying', async () => {
      await expect(
        service.listForTenant('t1', { cursor: 'invalid' }),
      ).rejects.toThrow('Invalid pagination cursor');
      expect(mockFindPageForTenant).not.toHaveBeenCalled();
    });

    it.each([
      { createdAt: 'not-a-date', id: '123e4567-e89b-42d3-a456-426614174002' },
      { createdAt: '2024-01-01T00:00:00.000Z', id: 'not-a-uuid' },
    ])(
      'rejects invalid decoded cursor values %j before querying',
      async (cursor) => {
        await expect(
          service.listForTenant('t1', { cursor: encodeCursor(cursor) }),
        ).rejects.toThrow('Invalid pagination cursor');
        expect(mockFindPageForTenant).not.toHaveBeenCalled();
      },
    );

    it('returns an empty final page', async () => {
      mockFindPageForTenant.mockResolvedValue({
        items: [],
        nextCursor: null,
        hasMore: false,
      });
      await expect(service.listForTenant('t1')).resolves.toEqual({
        data: [],
        pagination: { next_cursor: null, has_more: false },
      });
    });

    it('applies first-view TTL to terminal list results', async () => {
      jest.useFakeTimers().setSystemTime(viewedAt);
      mockFindPageForTenant.mockResolvedValue({
        items: [buildOperation({ state: OperationState.COMPLETED })],
        nextCursor: null,
        hasMore: false,
      });
      mockMarkFirstView.mockResolvedValue({
        viewedAt,
        expiresAt: new Date(viewedAt.getTime() + HOUR_MS),
      });
      const page = await service.listForTenant('t1');
      expect(page.data[0].viewedAt).toEqual(viewedAt);
      expect(mockMarkFirstView).toHaveBeenCalledTimes(1);
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('returns the original request through a tenant-scoped read', async () => {
      mockFindByIdForTenant.mockResolvedValue(buildOperation());
      await expect(
        service.getRequestForTenant('t1', 'op-1', requestActor),
      ).resolves.toEqual(baseRequest);
      expect(mockFindByIdForTenant).toHaveBeenCalledWith('op-1', 't1');
    });

    it('does not expose a missing or foreign request', async () => {
      mockFindByIdForTenant.mockResolvedValue(null);
      await expect(
        service.getRequestForTenant('t2', 'op-1', requestActor),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([null, 'credential.offer', 'credential.offer-batch-child'])(
      'rejects a missing or non-batch parent %s',
      async (type) => {
        mockFindByIdForTenant.mockResolvedValue(
          type ? buildOperation({ type }) : null,
        );
        await expect(
          service.listItemsForTenant('t1', 'op-1'),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(mockFindPageForTenant).not.toHaveBeenCalled();
      },
    );

    it('does not treat a batch child as a parent', async () => {
      mockFindByIdForTenant.mockResolvedValue(
        buildOperation({
          type: 'credential.offer-batch',
          batchId: 'parent',
        }),
      );
      await expect(
        service.listItemsForTenant('t1', 'op-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('filters batch items by parent and tenant with shared cursors', async () => {
      const cursor = {
        createdAt: createdAt.toISOString(),
        id: '123e4567-e89b-42d3-a456-426614174002',
      };
      mockFindByIdForTenant.mockResolvedValue(
        buildOperation({
          type: 'credential.offer-batch',
        }),
      );
      mockFindPageForTenant.mockResolvedValue({
        items: [],
        nextCursor: null,
        hasMore: false,
      });
      await service.listItemsForTenant('t1', 'op-1', {
        state: OperationState.FAILED,
        cursor: encodeCursor(cursor),
        limit: 20,
      });
      expect(mockFindPageForTenant).toHaveBeenCalledWith({
        tenantId: 't1',
        batchId: 'op-1',
        state: OperationState.FAILED,
        cursor,
        limit: 20,
      });
    });
  });

  describe('request access auditing', () => {
    it.each(['user', 'client'] as const)(
      'records the %s actor without copying PII',
      async (tokenType) => {
        jest.useFakeTimers().setSystemTime(viewedAt);
        mockFindByIdForTenant.mockResolvedValue(buildOperation());

        await expect(
          service.getRequestForTenant('t1', 'op-1', {
            sub: 'reader',
            tokenType,
          }),
        ).resolves.toEqual(baseRequest);

        expect(mockAuditWrite).toHaveBeenCalledWith({
          tenantId: 't1',
          actorId: 'reader',
          actorType:
            tokenType === 'client'
              ? AuditActorType.CLIENT
              : AuditActorType.USER,
          action: AuditAction.READ,
          resourceType: 'operation_request',
          resourceId: 'op-1',
          operationId: 'op-1',
          metadata: { accessed_at: viewedAt.toISOString() },
        });
      },
    );

    it('does not audit or disclose a missing or foreign request', async () => {
      mockFindByIdForTenant.mockResolvedValue(null);
      await expect(
        service.getRequestForTenant('t2', 'op-1', requestActor),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockAuditWrite).not.toHaveBeenCalled();
    });

    it('does not return the payload if the audit write fails', async () => {
      mockFindByIdForTenant.mockResolvedValue(buildOperation());
      mockAuditWrite.mockRejectedValue(new Error('Audit unavailable'));
      await expect(
        service.getRequestForTenant('t1', 'op-1', requestActor),
      ).rejects.toThrow('Audit unavailable');
    });

    it('waits for the audit write before returning the payload', async () => {
      mockFindByIdForTenant.mockResolvedValue(buildOperation());
      let finishAudit!: () => void;
      let startAudit!: () => void;
      const auditing = new Promise<void>((resolve) => {
        startAudit = resolve;
      });
      mockAuditWrite.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finishAudit = resolve;
            startAudit();
          }),
      );
      let disclosed = false;
      const read = service
        .getRequestForTenant('t1', 'op-1', requestActor)
        .then((value) => {
          disclosed = true;
          return value;
        });
      await auditing;
      expect(mockAuditWrite).toHaveBeenCalledTimes(1);
      expect(disclosed).toBe(false);
      finishAudit();
      await expect(read).resolves.toEqual(baseRequest);
    });
  });

  describe('batch item long-polling', () => {
    const query = { state: OperationState.FAILED, limit: 20 };

    beforeEach(() => {
      jest.useFakeTimers();
      mockFindByIdForTenant.mockImplementation(() =>
        Promise.resolve(
          buildOperation({
            type: 'credential.offer-batch',
            state: OperationState.PROCESSING,
          }),
        ),
      );
      mockFindPageForTenant.mockResolvedValue({
        items: [],
        nextCursor: null,
        hasMore: false,
      });
    });

    it('returns a normal page when a child changes, including outside the filtered page', async () => {
      mockBatchFingerprint
        .mockResolvedValueOnce('before')
        .mockResolvedValue('after');
      const pending = service.waitForItemsForTenant('t1', 'op-1', query, 30);
      await jest.advanceTimersByTimeAsync(1000);
      await expect(pending).resolves.toEqual({
        data: [],
        pagination: { next_cursor: null, has_more: false },
      });
      expect(mockBatchFingerprint).toHaveBeenCalledWith('op-1', 't1');
      expect(mockFindPageForTenant).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 't1',
          batchId: 'op-1',
          state: OperationState.FAILED,
          limit: 20,
        }),
      );
      expect(jest.getTimerCount()).toBe(0);
    });

    it('caps the wait at 30 seconds and returns the normal page on timeout', async () => {
      const pending = service.waitForItemsForTenant('t1', 'op-1', query, 60);
      await jest.advanceTimersByTimeAsync(29_999);
      expect(mockFindPageForTenant).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toMatchObject({ data: [] });
      expect(jest.getTimerCount()).toBe(0);
    });

    it('returns when the parent state changes', async () => {
      mockFindByIdForTenant
        .mockResolvedValueOnce(
          buildOperation({
            type: 'credential.offer-batch',
            state: OperationState.PROCESSING,
          }),
        )
        .mockResolvedValue(
          buildOperation({
            type: 'credential.offer-batch',
            state: OperationState.COMPLETED,
          }),
        );
      const pending = service.waitForItemsForTenant('t1', 'op-1', query, 30);
      await jest.advanceTimersByTimeAsync(1000);
      await expect(pending).resolves.toMatchObject({ data: [] });
      expect(mockBatchFingerprint).toHaveBeenCalledTimes(1);
    });

    it('does not wait for a terminal parent', async () => {
      mockFindByIdForTenant.mockResolvedValue(
        buildOperation({
          type: 'credential.offer-batch',
          state: OperationState.COMPLETED,
        }),
      );
      await expect(
        service.waitForItemsForTenant('t1', 'op-1', query, 30),
      ).resolves.toMatchObject({ data: [] });
      expect(mockBatchFingerprint).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('returns 404 immediately for a foreign or missing parent', async () => {
      mockFindByIdForTenant.mockResolvedValue(null);
      await expect(
        service.waitForItemsForTenant('t2', 'op-1', query, 30),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockBatchFingerprint).not.toHaveBeenCalled();
    });

    it('returns 404 if the parent is purged during the wait', async () => {
      mockFindByIdForTenant
        .mockResolvedValueOnce(
          buildOperation({
            type: 'credential.offer-batch',
            state: OperationState.PROCESSING,
          }),
        )
        .mockResolvedValue(null);
      const pending = service.waitForItemsForTenant('t1', 'op-1', query, 30);
      const assertion =
        expect(pending).rejects.toBeInstanceOf(NotFoundException);
      await jest.advanceTimersByTimeAsync(1000);
      await assertion;
    });

    it('cancels the timer on disconnect without further database queries', async () => {
      const abort = new AbortController();
      const pending = service.waitForItemsForTenant(
        't1',
        'op-1',
        query,
        30,
        abort.signal,
      );
      const assertion = expect(pending).rejects.toThrow(
        'Operation polling cancelled',
      );
      await jest.advanceTimersByTimeAsync(0);
      abort.abort();
      await assertion;
      expect(jest.getTimerCount()).toBe(0);
      expect(mockFindByIdForTenant).toHaveBeenCalledTimes(1);
      expect(mockFindPageForTenant).not.toHaveBeenCalled();
    });

    it('rejects promptly on abort while a repository lookup is still pending', async () => {
      const abort = new AbortController();
      const removed = jest.spyOn(abort.signal, 'removeEventListener');
      let finishLookup!: (value: Operation) => void;
      mockFindByIdForTenant.mockReturnValueOnce(new Promise<Operation>((resolve) => {
        finishLookup = resolve;
      }));
      const pending = service.waitForItemsForTenant('t1', 'op-1', query, 30, abort.signal);
      const assertion = expect(pending).rejects.toThrow('Operation polling cancelled');

      abort.abort();
      await assertion;
      expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));

      finishLookup(buildOperation({
        type: 'credential.offer-batch', state: OperationState.COMPLETED,
      }));
      await jest.advanceTimersByTimeAsync(0);
      expect(mockFindPageForTenant).not.toHaveBeenCalled();
      expect(mockMarkFirstView).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('does not start a repository lookup for an already-aborted request', async () => {
      const abort = new AbortController();
      abort.abort();

      await expect(service.waitForItemsForTenant('t1', 'op-1', query, 30, abort.signal))
        .rejects.toThrow('Operation polling cancelled');
      expect(mockFindByIdForTenant).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('removes abort listeners after a successful read', async () => {
      const abort = new AbortController();
      const added = jest.spyOn(abort.signal, 'addEventListener');
      const removed = jest.spyOn(abort.signal, 'removeEventListener');
      mockFindByIdForTenant.mockResolvedValue(buildOperation({
        type: 'credential.offer-batch', state: OperationState.COMPLETED,
      }));

      await service.waitForItemsForTenant('t1', 'op-1', query, 30, abort.signal);

      expect(added).toHaveBeenCalled();
      for (const [event, listener] of added.mock.calls) {
        expect(removed).toHaveBeenCalledWith(event, listener);
      }
      expect(jest.getTimerCount()).toBe(0);
    });

    it('removes the abort listener when a repository lookup rejects', async () => {
      const abort = new AbortController();
      const removed = jest.spyOn(abort.signal, 'removeEventListener');
      mockFindByIdForTenant.mockRejectedValueOnce(new Error('Lookup failed'));

      await expect(service.waitForItemsForTenant('t1', 'op-1', query, 30, abort.signal))
        .rejects.toThrow('Lookup failed');
      expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
      expect(mockFindPageForTenant).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });

    it.each([
      'initial parent',
      'initial fingerprint',
      'polled parent',
      'polled fingerprint',
      'final parent',
      'final page',
      'view tenant',
    ])(
      'does not mark children viewed when disconnected during the %s lookup',
      async (stage) => {
        const abort = new AbortController();
        let finishLookup!: (value: unknown) => void;
        const lookup = new Promise<unknown>((resolve) => {
          finishLookup = resolve;
        });
        const parent = buildOperation({
          type: 'credential.offer-batch',
          state: OperationState.PROCESSING,
        });
        const terminalParent = { ...parent, state: OperationState.COMPLETED };
        const page = {
          items: [buildOperation({ state: OperationState.COMPLETED })],
          nextCursor: null,
          hasMore: false,
        };
        let value: unknown;
        let elapsed = 0;
        switch (stage) {
          case 'initial parent':
            mockFindByIdForTenant.mockReturnValueOnce(lookup);
            value = terminalParent;
            break;
          case 'initial fingerprint':
            mockBatchFingerprint.mockReturnValueOnce(lookup);
            value = 'initial';
            break;
          case 'polled parent':
            mockFindByIdForTenant
              .mockResolvedValueOnce(parent)
              .mockReturnValueOnce(lookup);
            value = terminalParent;
            elapsed = 1000;
            break;
          case 'polled fingerprint':
            mockBatchFingerprint
              .mockResolvedValueOnce('initial')
              .mockReturnValueOnce(lookup);
            value = 'changed';
            elapsed = 1000;
            break;
          case 'final parent':
            mockFindByIdForTenant
              .mockResolvedValueOnce(parent)
              .mockResolvedValueOnce(terminalParent)
              .mockReturnValueOnce(lookup);
            value = terminalParent;
            elapsed = 1000;
            break;
          case 'final page':
            mockFindByIdForTenant.mockResolvedValue(terminalParent);
            mockFindPageForTenant.mockReturnValueOnce(lookup);
            value = page;
            break;
          case 'view tenant':
            mockFindByIdForTenant.mockResolvedValue(terminalParent);
            mockFindPageForTenant.mockResolvedValue(page);
            mockTenantFindById.mockReturnValueOnce(lookup);
            value = { id: 't1', config: {} };
            break;
        }
        const readItems = jest.spyOn(service, 'listItemsForTenant');
        const pending = service.waitForItemsForTenant(
          't1',
          'op-1',
          query,
          30,
          abort.signal,
        );
        const assertion = expect(pending).rejects.toThrow(
          'Operation polling cancelled',
        );
        await jest.advanceTimersByTimeAsync(elapsed);
        abort.abort();
        finishLookup(value);
        await assertion;

        if (stage.startsWith('initial') || stage.startsWith('polled')) {
          expect(readItems).not.toHaveBeenCalled();
        }
        if (stage !== 'final page' && stage !== 'view tenant') {
          expect(mockFindPageForTenant).not.toHaveBeenCalled();
        }
        expect(mockMarkFirstView).not.toHaveBeenCalled();
        expect(mockSave).not.toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(0);
      },
    );

    it('rejects invalid cursors without waiting', async () => {
      await expect(
        service.waitForItemsForTenant('t1', 'op-1', { cursor: 'invalid' }, 30),
      ).rejects.toThrow('Invalid pagination cursor');
      expect(mockFindByIdForTenant).not.toHaveBeenCalled();
    });
  });

  describe('read result semantics', () => {
    it('preserves type-specific completed results', async () => {
      const result = { credential_exchange_id: 'exchange' };
      mockFindByIdForTenant.mockResolvedValue(
        buildOperation({
          state: OperationState.COMPLETED,
          viewedAt,
          result,
        }),
      );
      expect((await service.getForTenant('t1', 'op-1')).result).toEqual(result);
    });

    it('returns a safe failure when stored details are absent', async () => {
      mockFindByIdForTenant.mockResolvedValue(
        buildOperation({
          state: OperationState.FAILED,
          viewedAt,
          result: null,
        }),
      );
      expect((await service.getForTenant('t1', 'op-1')).result).toEqual({
        code: 'OPERATION_FAILED',
        message: 'Operation failed',
      });
    });

    it.each([OperationState.PENDING, OperationState.FAILED])(
      'does not aggregate a %s batch parent',
      async (state) => {
        mockFindByIdForTenant.mockResolvedValue(
          buildOperation({
            type: 'credential.offer-batch',
            state,
            viewedAt,
            result: { code: 'BATCH_FAILED', message: 'Batch failed' },
          }),
        );
        const operation = await service.getForTenant('t1', 'op-1');
        expect(operation.result).toEqual(
          state === OperationState.PENDING
            ? null
            : { code: 'BATCH_FAILED', message: 'Batch failed' },
        );
        expect(mockCountByBatch).not.toHaveBeenCalled();
        expect(mockFindFailedBatchItems).not.toHaveBeenCalled();
      },
    );

    it.each([OperationState.PENDING, OperationState.PROCESSING])(
      'hides stored partial results for %s non-batch operations',
      async (state) => {
        mockFindByIdForTenant.mockResolvedValue(
          buildOperation({
            state,
            result: { partial: true },
          }),
        );
        expect((await service.getForTenant('t1', 'op-1')).result).toBeNull();
      },
    );

    it('returns only code and message for ordinary failures', async () => {
      mockFindByIdForTenant.mockResolvedValue(
        buildOperation({
          state: OperationState.FAILED,
          viewedAt,
          result: { code: 'FAILED', message: 'Failure', internal: 'hidden' },
        }),
      );
      expect((await service.getForTenant('t1', 'op-1')).result).toEqual({
        code: 'FAILED',
        message: 'Failure',
      });
    });

    it('preserves registration progress', async () => {
      const result = {
        credential_definition_id: 'definition',
        stage: 'pending',
      };
      mockFindByIdForTenant.mockResolvedValue(
        buildOperation({
          type: OPERATION_TYPE.CREDENTIAL_DEFINITION_REGISTER,
          result,
        }),
      );
      expect((await service.getForTenant('t1', 'op-1')).result).toEqual(result);
    });

    it('computes processing batch counters without saving the summary', async () => {
      mockFindByIdForTenant.mockResolvedValue(
        buildOperation({
          type: 'credential.offer-batch',
          state: OperationState.PROCESSING,
        }),
      );
      mockCountByBatch.mockResolvedValue({
        pending: 2,
        processing: 1,
        completed: 3,
        failed: 1,
      });
      expect((await service.getForTenant('t1', 'op-1')).result).toEqual({
        total: 7,
        pending: 2,
        processing: 1,
        completed: 3,
        failed: 1,
      });
      expect(mockCountByBatch).toHaveBeenCalledWith('op-1', 't1');
      expect(mockFindFailedBatchItems).not.toHaveBeenCalled();
      expect(mockSave).not.toHaveBeenCalled();
    });

    it.each([
      { state: OperationState.COMPLETED, completed: 10, failed: 0 },
      { state: OperationState.FAILED, completed: 9, failed: 1 },
    ])(
      'preserves settled $state batch counts when all children have been purged',
      async ({ state, completed, failed }) => {
        const settled = { pending: 0, processing: 0, completed, failed };
        const operation = buildOperation({
          type: 'credential.offer-batch',
          state,
          viewedAt,
          result: settled,
        });
        mockFindByIdForTenant.mockResolvedValue(operation);
        mockCountByBatch.mockResolvedValue({
          pending: 0,
          processing: 0,
          completed: 0,
          failed: 0,
        });
        mockFindFailedBatchItems.mockResolvedValue([]);

        expect((await service.getForTenant('t1', 'op-1')).result).toEqual({
          total: 10,
          completed,
          failed,
          errors: [],
        });
        expect(mockCountByBatch).not.toHaveBeenCalled();
        expect(operation.result).toEqual(settled);
        expect(mockSave).not.toHaveBeenCalled();
      },
    );

    it('returns a failed batch settlement summary and marks its first view', async () => {
      jest.useFakeTimers().setSystemTime(viewedAt);
      const settled = { pending: 0, processing: 0, completed: 2, failed: 1 };
      mockFindByIdForTenant.mockResolvedValue(
        buildOperation({
          type: 'credential.offer-batch',
          state: OperationState.FAILED,
          result: settled,
        }),
      );
      mockMarkFirstView.mockResolvedValue({
        viewedAt,
        expiresAt: new Date(viewedAt.getTime() + 24 * HOUR_MS),
      });
      mockFindFailedBatchItems.mockResolvedValue([
        buildOperation({
          id: 'failed-child',
          state: OperationState.FAILED,
          result: {
            code: 'ADAPTER_TIMEOUT',
            message: 'Adapter timed out',
            internal: 'hidden',
          },
        }),
      ]);

      const result = await service.getForTenant('t1', 'op-1');

      expect(result.state).toBe(OperationState.FAILED);
      expect(result.result).toEqual({
        total: 3,
        completed: 2,
        failed: 1,
        errors: [
          {
            id: 'failed-child',
            code: 'ADAPTER_TIMEOUT',
            message: 'Adapter timed out',
          },
        ],
      });
      expect(result.viewedAt).toEqual(viewedAt);
      expect(result.expiresAt.getTime()).toBe(
        viewedAt.getTime() + 24 * HOUR_MS,
      );
      expect(mockCountByBatch).not.toHaveBeenCalled();
      expect(mockFindFailedBatchItems).toHaveBeenCalledWith('op-1', 't1');
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('caps a failed batch settlement error sample at 100', async () => {
      mockFindByIdForTenant.mockResolvedValue(
        buildOperation({
          type: 'credential.offer-batch',
          state: OperationState.FAILED,
          viewedAt,
          result: { pending: 0, processing: 0, completed: 2, failed: 101 },
        }),
      );
      mockFindFailedBatchItems.mockResolvedValue(
        Array.from({ length: 101 }, (_, index) =>
          buildOperation({
            id: `failed-child-${index}`,
            state: OperationState.FAILED,
            result: { code: 'FAILED', message: 'Failure' },
          }),
        ),
      );
      const result = (await service.getForTenant('t1', 'op-1')).result;
      expect(result).toMatchObject({ total: 103, completed: 2, failed: 101 });
      expect(result?.errors).toHaveLength(100);
      expect(mockCountByBatch).not.toHaveBeenCalled();
    });

    it('uses live counts rather than a stored snapshot while processing', async () => {
      mockFindByIdForTenant.mockResolvedValue(
        buildOperation({
          type: 'credential.offer-batch',
          state: OperationState.PROCESSING,
          result: { completed: 9, failed: 1 },
        }),
      );
      mockCountByBatch.mockResolvedValue({
        pending: 1,
        processing: 1,
        completed: 2,
        failed: 0,
      });

      expect((await service.getForTenant('t1', 'op-1')).result).toEqual({
        total: 4,
        pending: 1,
        processing: 1,
        completed: 2,
        failed: 0,
      });
      expect(mockCountByBatch).toHaveBeenCalledWith('op-1', 't1');
    });

    it('caps legacy completed batch errors without a settlement snapshot', async () => {
      mockFindByIdForTenant.mockResolvedValue(
        buildOperation({
          type: 'credential.offer-batch',
          state: OperationState.COMPLETED,
          viewedAt,
        }),
      );
      mockCountByBatch.mockResolvedValue({
        pending: 0,
        processing: 0,
        completed: 2,
        failed: 101,
      });
      mockFindFailedBatchItems.mockResolvedValue(
        Array.from({ length: 101 }, (_, index) =>
          buildOperation({
            id: `child-${index}`,
            state: OperationState.FAILED,
            result: { code: 'FAILED', message: 'Failure', internal: 'hidden' },
          }),
        ),
      );
      const result = (await service.getForTenant('t1', 'op-1')).result;
      expect(result).toMatchObject({ total: 103, completed: 2, failed: 101 });
      expect(result?.errors).toHaveLength(100);
      expect((result?.errors as unknown[])[0]).toEqual({
        id: 'child-0',
        code: 'FAILED',
        message: 'Failure',
      });
      expect(mockFindFailedBatchItems).toHaveBeenCalledWith('op-1', 't1');
      expect(mockSave).not.toHaveBeenCalled();
    });
  });

  it('uses the original creation time for registration retention', async () => {
    const operation = buildOperation({
      type: OPERATION_TYPE.CREDENTIAL_DEFINITION_REGISTER,
      result: {
        registration: { stage: 'preflight' },
      },
    });
    mockFindById.mockResolvedValue(operation);
    mockSave.mockImplementation((value: Operation) => Promise.resolve(value));
    const result = await service.transitionState(
      operation.id,
      OperationState.PROCESSING,
    );
    expect(result.expiresAt).toEqual(
      new Date(createdAt.getTime() + 72 * HOUR_MS),
    );
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

    it('reads transaction-owned operations by both id and tenant', async () => {
      const operation = buildOperation();
      const findOne = jest.fn().mockResolvedValue(operation);
      mockSave.mockImplementation((op: Operation) => Promise.resolve(op));
      const manager = { findOne } as unknown as EntityManager;

      await service.transitionState(
        'op-1',
        OperationState.COMPLETED,
        { id: 'definition-1' },
        manager,
        't1',
      );

      expect(findOne).toHaveBeenCalledWith(Operation, {
        where: { id: 'op-1', tenantId: 't1' },
      });
      expect(mockSave).toHaveBeenCalledWith(operation, manager);
      expect(mockFindById).not.toHaveBeenCalled();
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
