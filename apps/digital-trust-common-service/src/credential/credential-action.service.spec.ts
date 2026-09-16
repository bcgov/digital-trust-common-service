import {
  ConnectorUnavailableError,
  CredentialExchangeState,
} from '@app/credential-ports';
import { JOB_QUEUES } from '@app/pg-boss';
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { JobsService } from '../jobs/jobs.service';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { Operation, OperationState } from '../operation/operation.entity';
import { OperationRepository } from '../operation/operation.repository';
import { OperationService } from '../operation/operation.service';
import { operationStatesBelow } from '../protocol-state-change/state-mapping';

import { CredentialActionService } from './credential-action.service';

describe('CredentialActionService', () => {
  let service: CredentialActionService;
  let mockFindByIdForTenant: jest.Mock;
  let mockFindById: jest.Mock;
  let mockFindByExternalIdForTenant: jest.Mock;
  let mockFindLatestByExternalIdAndTypeForTenant: jest.Mock;
  let mockCreateOperation: jest.Mock;
  let mockTransitionState: jest.Mock;
  let mockTransitionStateIfForward: jest.Mock;
  let mockResolve: jest.Mock;
  let mockEmit: jest.Mock;
  let mockAcceptOffer: jest.Mock;
  let mockRejectOffer: jest.Mock;
  let mockEventEmit: jest.Mock;
  let mockSendInTransaction: jest.Mock;
  let mockTransaction: jest.Mock;
  const mockManager = {} as EntityManager;

  const tenantId = '123e4567-e89b-12d3-a456-426614174001';
  const exchangeId = '123e4567-e89b-12d3-a456-426614174000';
  const externalId = 'agent-exchange-123';
  const createdAt = new Date('2024-01-01T00:00:00.000Z');

  const buildOffer = (overrides: Partial<Operation> = {}): Operation =>
    ({
      id: exchangeId,
      tenantId,
      batchId: null,
      type: OPERATION_TYPE.CREDENTIAL_OFFER,
      state: OperationState.COMPLETED,
      request: { method: 'POST', path: '/offer', body: {} },
      result: null,
      externalId,
      viewedAt: null,
      expiresAt: new Date('2024-01-04T00:00:00.000Z'),
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    }) as Operation;

  const buildActionOperation = (
    overrides: Partial<Operation> = {},
  ): Operation =>
    ({
      id: 'action-op-1',
      tenantId,
      batchId: null,
      type: OPERATION_TYPE.CREDENTIAL_ACCEPT,
      state: OperationState.PENDING,
      request: { method: 'POST', path: '/accept', body: {} },
      result: null,
      externalId,
      viewedAt: null,
      expiresAt: new Date('2024-01-04T00:00:00.000Z'),
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    }) as Operation;

  beforeEach(async () => {
    mockFindByIdForTenant = jest.fn();
    mockFindById = jest.fn();
    mockFindByExternalIdForTenant = jest.fn().mockResolvedValue(null);
    mockFindLatestByExternalIdAndTypeForTenant = jest
      .fn()
      .mockResolvedValue(null);
    mockCreateOperation = jest.fn();
    mockTransitionState = jest.fn();
    mockTransitionStateIfForward = jest.fn();
    mockResolve = jest.fn();
    mockEmit = jest.fn().mockResolvedValue(undefined);
    mockAcceptOffer = jest.fn();
    mockRejectOffer = jest.fn();
    mockEventEmit = jest.fn();
    mockSendInTransaction = jest.fn().mockResolvedValue('job-1');
    mockTransaction = jest.fn(
      async (callback: (manager: EntityManager) => Promise<unknown>) =>
        callback(mockManager),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialActionService,
        {
          provide: OperationRepository,
          useValue: {
            findByIdForTenant: mockFindByIdForTenant,
            findById: mockFindById,
            findByExternalIdForTenant: mockFindByExternalIdForTenant,
            findLatestByExternalIdAndTypeForTenant:
              mockFindLatestByExternalIdAndTypeForTenant,
          },
        },
        {
          provide: OperationService,
          useValue: {
            createOperation: mockCreateOperation,
            transitionState: mockTransitionState,
            transitionStateIfForward: mockTransitionStateIfForward,
          },
        },
        {
          provide: AdapterRegistry,
          useValue: { resolve: mockResolve },
        },
        {
          provide: DomainAuditService,
          useValue: { emit: mockEmit },
        },
        {
          provide: EventEmitter2,
          useValue: { emit: mockEventEmit },
        },
        {
          provide: JobsService,
          useValue: { sendInTransaction: mockSendInTransaction },
        },
        {
          provide: DataSource,
          useValue: { transaction: mockTransaction },
        },
      ],
    }).compile();

    service = module.get(CredentialActionService);

    mockResolve.mockResolvedValue({
      adapter: {
        acceptOffer: mockAcceptOffer,
        rejectOffer: mockRejectOffer,
      },
      context: {
        connectorId: 'connector-1',
        tenantId,
        endpointUrl: 'https://agent.example.com',
        credentials: { apiKey: 'secret' },
      },
    });
  });

  describe('accept', () => {
    it('throws 404 when the offer operation is not found', async () => {
      mockFindByIdForTenant.mockResolvedValue(null);

      await expect(service.accept(tenantId, exchangeId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });

    it('throws 404 when the offer has no externalId yet', async () => {
      mockFindByIdForTenant.mockResolvedValue(buildOffer({ externalId: null }));

      await expect(service.accept(tenantId, exchangeId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws 404 when the Operation is not a credential offer', async () => {
      mockFindByIdForTenant.mockResolvedValue(
        buildOffer({ type: OPERATION_TYPE.CREDENTIAL_REVOKE }),
      );

      await expect(service.accept(tenantId, exchangeId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });

    it('completes synchronously when the adapter confirms with Done', async () => {
      mockFindByIdForTenant.mockResolvedValue(buildOffer());
      mockCreateOperation.mockResolvedValue(buildActionOperation());
      mockAcceptOffer.mockResolvedValue({
        id: 'exch-1',
        state: CredentialExchangeState.Done,
        format: 'anoncreds',
        attributes: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:01.000Z',
      });
      const completedOperation = buildActionOperation({
        state: OperationState.COMPLETED,
      });
      mockTransitionStateIfForward.mockResolvedValue(completedOperation);

      const result = await service.accept(tenantId, exchangeId);

      expect(mockCreateOperation).toHaveBeenCalledWith({
        tenantId,
        type: OPERATION_TYPE.CREDENTIAL_ACCEPT,
        request: {
          method: 'POST',
          path: `/api/v1/tenants/${tenantId}/credentials/${exchangeId}/accept`,
          body: {},
        },
        externalId,
      });
      expect(mockAcceptOffer).toHaveBeenCalledWith(
        expect.objectContaining({ connectorId: 'connector-1' }),
        externalId,
      );
      expect(mockTransitionStateIfForward).toHaveBeenCalledWith(
        'action-op-1',
        OperationState.COMPLETED,
        operationStatesBelow(OperationState.COMPLETED),
        expect.objectContaining({ id: 'exch-1', state: 'done' }),
        mockManager,
      );
      expect(mockFindById).not.toHaveBeenCalled();
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          action: AuditAction.HOLD,
          resourceType: 'credential',
          resourceId: exchangeId,
        }),
      );
      expect(mockEventEmit).toHaveBeenCalledWith('credential.accepted', {
        tenantId,
        externalId,
      });
      expect(mockSendInTransaction).toHaveBeenCalledWith(
        mockManager,
        'webhook.dispatch',
        expect.objectContaining({
          tenantId,
          event: 'credential.accepted',
          resourceId: externalId,
        }),
      );
      expect(result).toBe(completedOperation);
    });

    it('reuses an already in-flight holder-action operation instead of creating a duplicate', async () => {
      mockFindByIdForTenant.mockResolvedValue(buildOffer());
      const existingInFlight = buildActionOperation({
        id: 'action-op-existing',
        state: OperationState.PROCESSING,
      });
      mockFindByExternalIdForTenant.mockResolvedValue(existingInFlight);

      const result = await service.accept(tenantId, exchangeId);

      expect(mockFindByExternalIdForTenant).toHaveBeenCalledWith(
        tenantId,
        externalId,
        [OPERATION_TYPE.CREDENTIAL_ACCEPT],
      );
      expect(mockCreateOperation).not.toHaveBeenCalled();
      expect(mockResolve).not.toHaveBeenCalled();
      expect(result).toBe(existingInFlight);
    });

    it('retries the adapter call against a durable PENDING row instead of returning it unresolved (recovers from a crash between createOperation and the adapter call)', async () => {
      mockFindByIdForTenant.mockResolvedValue(buildOffer());
      const stalePending = buildActionOperation({
        id: 'action-op-existing',
        state: OperationState.PENDING,
      });
      mockFindByExternalIdForTenant.mockResolvedValue(stalePending);
      mockAcceptOffer.mockResolvedValue({
        id: 'exch-1',
        state: CredentialExchangeState.Done,
        format: 'anoncreds',
        attributes: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:01.000Z',
      });
      const completedOperation = buildActionOperation({
        id: 'action-op-existing',
        state: OperationState.COMPLETED,
      });
      mockTransitionStateIfForward.mockResolvedValue(completedOperation);

      const result = await service.accept(tenantId, exchangeId);

      expect(mockCreateOperation).not.toHaveBeenCalled();
      expect(mockResolve).toHaveBeenCalledWith(tenantId);
      expect(mockAcceptOffer).toHaveBeenCalledWith(
        expect.objectContaining({ connectorId: 'connector-1' }),
        externalId,
      );
      expect(mockTransitionStateIfForward).toHaveBeenCalledWith(
        'action-op-existing',
        OperationState.COMPLETED,
        operationStatesBelow(OperationState.COMPLETED),
        expect.objectContaining({ id: 'exch-1' }),
        mockManager,
      );
      expect(result).toBe(completedOperation);
    });

    it('returns the concurrent winner when createOperation loses the atomic claim (unique violation)', async () => {
      mockFindByIdForTenant.mockResolvedValue(buildOffer());
      const winner = buildActionOperation({
        id: 'action-op-winner',
        state: OperationState.PROCESSING,
      });
      // Pre-check observes no in-flight row (the race window), the insert
      // then loses the uq_operation_inflight_holder_action constraint to a
      // concurrent request, and the recovery lookup finds that winner —
      // even though it has since moved past PENDING/PROCESSING.
      mockFindByExternalIdForTenant.mockResolvedValueOnce(null);
      mockFindLatestByExternalIdAndTypeForTenant.mockResolvedValue(winner);
      mockCreateOperation.mockRejectedValue(
        Object.assign(new Error('duplicate key value'), {
          driverError: { code: '23505' },
        }),
      );

      const result = await service.accept(tenantId, exchangeId);

      expect(mockFindLatestByExternalIdAndTypeForTenant).toHaveBeenCalledWith(
        tenantId,
        externalId,
        OPERATION_TYPE.CREDENTIAL_ACCEPT,
      );
      expect(mockResolve).not.toHaveBeenCalled();
      expect(result).toBe(winner);
    });

    it('retries the adapter call when the unique-violation winner is itself still PENDING', async () => {
      mockFindByIdForTenant.mockResolvedValue(buildOffer());
      const pendingWinner = buildActionOperation({
        id: 'action-op-winner',
        state: OperationState.PENDING,
      });
      mockFindByExternalIdForTenant.mockResolvedValueOnce(null);
      mockFindLatestByExternalIdAndTypeForTenant.mockResolvedValue(
        pendingWinner,
      );
      mockCreateOperation.mockRejectedValue(
        Object.assign(new Error('duplicate key value'), {
          driverError: { code: '23505' },
        }),
      );
      mockAcceptOffer.mockResolvedValue({
        id: 'exch-1',
        state: CredentialExchangeState.Done,
        format: 'anoncreds',
        attributes: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:01.000Z',
      });
      const completedOperation = buildActionOperation({
        id: 'action-op-winner',
        state: OperationState.COMPLETED,
      });
      mockTransitionStateIfForward.mockResolvedValue(completedOperation);

      const result = await service.accept(tenantId, exchangeId);

      expect(mockResolve).toHaveBeenCalledWith(tenantId);
      expect(mockTransitionStateIfForward).toHaveBeenCalledWith(
        'action-op-winner',
        OperationState.COMPLETED,
        operationStatesBelow(OperationState.COMPLETED),
        expect.objectContaining({ id: 'exch-1' }),
        mockManager,
      );
      expect(result).toBe(completedOperation);
    });

    it('propagates a createOperation error that is not a unique violation', async () => {
      mockFindByIdForTenant.mockResolvedValue(buildOffer());
      const dbError = new Error('connection terminated');
      mockCreateOperation.mockRejectedValue(dbError);

      await expect(service.accept(tenantId, exchangeId)).rejects.toBe(dbError);
      expect(mockFindByExternalIdForTenant).toHaveBeenCalledTimes(1);
      expect(mockFindLatestByExternalIdAndTypeForTenant).not.toHaveBeenCalled();
      expect(mockResolve).not.toHaveBeenCalled();
    });

    it('propagates the original unique-violation error when no winner can be found', async () => {
      mockFindByIdForTenant.mockResolvedValue(buildOffer());
      const raceError = Object.assign(new Error('duplicate key value'), {
        driverError: { code: '23505' },
      });
      mockFindByExternalIdForTenant.mockResolvedValueOnce(null);
      mockFindLatestByExternalIdAndTypeForTenant.mockResolvedValue(null);
      mockCreateOperation.mockRejectedValue(raceError);

      await expect(service.accept(tenantId, exchangeId)).rejects.toBe(
        raceError,
      );
    });

    it('does not regress or re-publish when the protocol worker already completed the action operation first', async () => {
      mockFindByIdForTenant.mockResolvedValue(buildOffer());
      mockCreateOperation.mockResolvedValue(buildActionOperation());
      mockAcceptOffer.mockResolvedValue({
        id: 'exch-1',
        state: CredentialExchangeState.Done,
        format: 'anoncreds',
        attributes: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:01.000Z',
      });
      // The guarded write loses: the protocol.state-change worker already
      // correlated and completed this same actionOperation first.
      mockTransitionStateIfForward.mockResolvedValue(null);
      const alreadyCompleted = buildActionOperation({
        state: OperationState.COMPLETED,
      });
      mockFindById.mockResolvedValue(alreadyCompleted);

      const result = await service.accept(tenantId, exchangeId);

      expect(mockFindById).toHaveBeenCalledWith('action-op-1');
      expect(mockSendInTransaction).not.toHaveBeenCalled();
      expect(mockEventEmit).not.toHaveBeenCalled();
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          action: AuditAction.HOLD,
          resourceType: 'credential',
          resourceId: exchangeId,
          metadata: { action: 'accept', state: OperationState.COMPLETED },
        }),
      );
      expect(result).toBe(alreadyCompleted);
    });

    it('throws 404 if the action operation vanished after losing the race', async () => {
      mockFindByIdForTenant.mockResolvedValue(buildOffer());
      mockCreateOperation.mockResolvedValue(buildActionOperation());
      mockAcceptOffer.mockResolvedValue({
        id: 'exch-1',
        state: CredentialExchangeState.Done,
        format: 'anoncreds',
        attributes: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:01.000Z',
      });
      mockTransitionStateIfForward.mockResolvedValue(null);
      mockFindById.mockResolvedValue(null);

      await expect(service.accept(tenantId, exchangeId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rolls back the state transition and propagates the error when the webhook-dispatch enqueue fails, instead of leaving a COMPLETED operation with no durable notification', async () => {
      mockFindByIdForTenant.mockResolvedValue(buildOffer());
      mockCreateOperation.mockResolvedValue(buildActionOperation());
      mockAcceptOffer.mockResolvedValue({
        id: 'exch-1',
        state: CredentialExchangeState.Done,
        format: 'anoncreds',
        attributes: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:01.000Z',
      });
      mockTransitionStateIfForward.mockResolvedValue(
        buildActionOperation({ state: OperationState.COMPLETED }),
      );
      mockSendInTransaction.mockRejectedValue(new Error('queue unavailable'));

      await expect(service.accept(tenantId, exchangeId)).rejects.toThrow(
        'queue unavailable',
      );
      expect(mockEmit).not.toHaveBeenCalled();
      expect(mockEventEmit).not.toHaveBeenCalled();
    });

    it('stays pending when the adapter has not confirmed yet, and does not emit a domain event', async () => {
      mockFindByIdForTenant.mockResolvedValue(buildOffer());
      mockCreateOperation.mockResolvedValue(buildActionOperation());
      mockAcceptOffer.mockResolvedValue({
        id: 'exch-1',
        state: CredentialExchangeState.RequestSent,
        format: 'anoncreds',
        attributes: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:01.000Z',
      });
      mockTransitionStateIfForward.mockResolvedValue(
        buildActionOperation({ state: OperationState.PROCESSING }),
      );

      const result = await service.accept(tenantId, exchangeId);

      expect(mockTransitionStateIfForward).toHaveBeenCalledWith(
        'action-op-1',
        OperationState.PROCESSING,
        operationStatesBelow(OperationState.PROCESSING),
        null,
        mockManager,
      );
      expect(result.state).toBe(OperationState.PROCESSING);
      expect(mockEventEmit).not.toHaveBeenCalled();
      expect(mockSendInTransaction).not.toHaveBeenCalled();
    });

    it('transitions to failed on an AdapterError rather than throwing, without emitting a domain event', async () => {
      mockFindByIdForTenant.mockResolvedValue(buildOffer());
      mockCreateOperation.mockResolvedValue(buildActionOperation());
      mockAcceptOffer.mockRejectedValue(
        new ConnectorUnavailableError('Connector down'),
      );
      const failedOperation = buildActionOperation({
        state: OperationState.FAILED,
        result: { code: 'CONNECTOR_UNAVAILABLE', message: 'Connector down' },
      });
      mockTransitionStateIfForward.mockResolvedValue(failedOperation);

      const result = await service.accept(tenantId, exchangeId);

      expect(mockTransitionStateIfForward).toHaveBeenCalledWith(
        'action-op-1',
        OperationState.FAILED,
        operationStatesBelow(OperationState.FAILED),
        { code: 'CONNECTOR_UNAVAILABLE', message: 'Connector down' },
        mockManager,
      );
      expect(mockFindById).not.toHaveBeenCalled();
      expect(result).toBe(failedOperation);
      expect(mockEventEmit).not.toHaveBeenCalled();
      expect(mockSendInTransaction).toHaveBeenCalledWith(
        mockManager,
        JOB_QUEUES.WEBHOOK_DISPATCH,
        expect.objectContaining({
          tenantId,
          event: 'credential.accept.failed',
          resourceId: externalId,
        }),
      );
    });

    it('does not regress an already-completed operation to failed when the protocol worker won first', async () => {
      mockFindByIdForTenant.mockResolvedValue(buildOffer());
      mockCreateOperation.mockResolvedValue(buildActionOperation());
      mockAcceptOffer.mockRejectedValue(
        new ConnectorUnavailableError('Connector down'),
      );
      mockTransitionStateIfForward.mockResolvedValue(null);
      const alreadyCompleted = buildActionOperation({
        state: OperationState.COMPLETED,
        result: { id: 'exch-1', state: 'done' },
      });
      mockFindById.mockResolvedValue(alreadyCompleted);

      const result = await service.accept(tenantId, exchangeId);

      expect(mockFindById).toHaveBeenCalledWith('action-op-1');
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { action: 'accept', state: OperationState.COMPLETED },
        }),
      );
      expect(result).toBe(alreadyCompleted);
    });

    it('throws 404 if the action operation vanished after losing the failure race', async () => {
      mockFindByIdForTenant.mockResolvedValue(buildOffer());
      mockCreateOperation.mockResolvedValue(buildActionOperation());
      mockAcceptOffer.mockRejectedValue(
        new ConnectorUnavailableError('Connector down'),
      );
      mockTransitionStateIfForward.mockResolvedValue(null);
      mockFindById.mockResolvedValue(null);

      await expect(service.accept(tenantId, exchangeId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('propagates an unexpected (non-adapter) error', async () => {
      mockFindByIdForTenant.mockResolvedValue(buildOffer());
      mockCreateOperation.mockResolvedValue(buildActionOperation());
      mockAcceptOffer.mockRejectedValue(new Error('boom'));

      await expect(service.accept(tenantId, exchangeId)).rejects.toThrow(
        'boom',
      );
      expect(mockTransitionStateIfForward).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('completes synchronously since rejectOffer resolves with void', async () => {
      mockFindByIdForTenant.mockResolvedValue(buildOffer());
      mockCreateOperation.mockResolvedValue(
        buildActionOperation({ type: OPERATION_TYPE.CREDENTIAL_REJECT }),
      );
      mockRejectOffer.mockResolvedValue(undefined);
      const completedOperation = buildActionOperation({
        type: OPERATION_TYPE.CREDENTIAL_REJECT,
        state: OperationState.COMPLETED,
        result: {},
      });
      mockTransitionStateIfForward.mockResolvedValue(completedOperation);

      const result = await service.reject(tenantId, exchangeId);

      expect(mockCreateOperation).toHaveBeenCalledWith(
        expect.objectContaining({ type: OPERATION_TYPE.CREDENTIAL_REJECT }),
      );
      expect(mockRejectOffer).toHaveBeenCalledWith(
        expect.objectContaining({ connectorId: 'connector-1' }),
        externalId,
      );
      expect(mockTransitionStateIfForward).toHaveBeenCalledWith(
        'action-op-1',
        OperationState.COMPLETED,
        operationStatesBelow(OperationState.COMPLETED),
        {},
        mockManager,
      );
      expect(mockEventEmit).toHaveBeenCalledWith('credential.rejected', {
        tenantId,
        externalId,
      });
      expect(mockSendInTransaction).toHaveBeenCalledWith(
        mockManager,
        'webhook.dispatch',
        expect.objectContaining({
          tenantId,
          event: 'credential.rejected',
          resourceId: externalId,
        }),
      );
      expect(result).toBe(completedOperation);
    });

    it('transitions to failed on an AdapterError', async () => {
      mockFindByIdForTenant.mockResolvedValue(buildOffer());
      mockCreateOperation.mockResolvedValue(
        buildActionOperation({ type: OPERATION_TYPE.CREDENTIAL_REJECT }),
      );
      mockRejectOffer.mockRejectedValue(
        new ConnectorUnavailableError('Connector down'),
      );
      const failedOperation = buildActionOperation({
        type: OPERATION_TYPE.CREDENTIAL_REJECT,
        state: OperationState.FAILED,
        result: { code: 'CONNECTOR_UNAVAILABLE', message: 'Connector down' },
      });
      mockTransitionStateIfForward.mockResolvedValue(failedOperation);

      const result = await service.reject(tenantId, exchangeId);

      expect(mockTransitionStateIfForward).toHaveBeenCalledWith(
        'action-op-1',
        OperationState.FAILED,
        operationStatesBelow(OperationState.FAILED),
        { code: 'CONNECTOR_UNAVAILABLE', message: 'Connector down' },
        mockManager,
      );
      expect(result).toBe(failedOperation);
      expect(mockSendInTransaction).toHaveBeenCalledWith(
        mockManager,
        JOB_QUEUES.WEBHOOK_DISPATCH,
        expect.objectContaining({
          tenantId,
          event: 'credential.reject.failed',
          resourceId: externalId,
        }),
      );
    });
  });
});
