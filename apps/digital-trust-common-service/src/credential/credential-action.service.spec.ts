import {
  ConnectorUnavailableError,
  CredentialExchangeState,
} from '@app/credential-ports';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { Operation, OperationState } from '../operation/operation.entity';
import { OperationRepository } from '../operation/operation.repository';
import { OperationService } from '../operation/operation.service';

import { CredentialActionService } from './credential-action.service';

describe('CredentialActionService', () => {
  let service: CredentialActionService;
  let mockFindByIdForTenant: jest.Mock;
  let mockCreateOperation: jest.Mock;
  let mockTransitionState: jest.Mock;
  let mockResolve: jest.Mock;
  let mockEmit: jest.Mock;
  let mockAcceptOffer: jest.Mock;
  let mockRejectOffer: jest.Mock;

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
    mockCreateOperation = jest.fn();
    mockTransitionState = jest.fn();
    mockResolve = jest.fn();
    mockEmit = jest.fn().mockResolvedValue(undefined);
    mockAcceptOffer = jest.fn();
    mockRejectOffer = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialActionService,
        {
          provide: OperationRepository,
          useValue: { findByIdForTenant: mockFindByIdForTenant },
        },
        {
          provide: OperationService,
          useValue: {
            createOperation: mockCreateOperation,
            transitionState: mockTransitionState,
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
      ],
    }).compile();

    service = module.get(CredentialActionService);

    mockResolve.mockResolvedValue({
      adapter: {
        acceptOffer: mockAcceptOffer,
        rejectOffer: mockRejectOffer,
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
      mockTransitionState.mockResolvedValue(completedOperation);

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
      expect(mockAcceptOffer).toHaveBeenCalledWith(externalId);
      expect(mockTransitionState).toHaveBeenCalledWith(
        'action-op-1',
        OperationState.COMPLETED,
        expect.objectContaining({ id: 'exch-1', state: 'done' }),
      );
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          action: AuditAction.HOLD,
          resourceType: 'credential',
          resourceId: exchangeId,
        }),
      );
      expect(result).toBe(completedOperation);
    });

    it('stays pending when the adapter has not confirmed yet', async () => {
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
      mockTransitionState.mockResolvedValue(
        buildActionOperation({ state: OperationState.PROCESSING }),
      );

      const result = await service.accept(tenantId, exchangeId);

      expect(mockTransitionState).toHaveBeenCalledWith(
        'action-op-1',
        OperationState.PROCESSING,
        null,
      );
      expect(result.state).toBe(OperationState.PROCESSING);
    });

    it('transitions to failed on an AdapterError rather than throwing', async () => {
      mockFindByIdForTenant.mockResolvedValue(buildOffer());
      mockCreateOperation.mockResolvedValue(buildActionOperation());
      mockAcceptOffer.mockRejectedValue(
        new ConnectorUnavailableError('Connector down'),
      );
      const failedOperation = buildActionOperation({
        state: OperationState.FAILED,
        result: { code: 'CONNECTOR_UNAVAILABLE', message: 'Connector down' },
      });
      mockTransitionState.mockResolvedValue(failedOperation);

      const result = await service.accept(tenantId, exchangeId);

      expect(mockTransitionState).toHaveBeenCalledWith(
        'action-op-1',
        OperationState.FAILED,
        { code: 'CONNECTOR_UNAVAILABLE', message: 'Connector down' },
      );
      expect(result).toBe(failedOperation);
    });

    it('propagates an unexpected (non-adapter) error', async () => {
      mockFindByIdForTenant.mockResolvedValue(buildOffer());
      mockCreateOperation.mockResolvedValue(buildActionOperation());
      mockAcceptOffer.mockRejectedValue(new Error('boom'));

      await expect(service.accept(tenantId, exchangeId)).rejects.toThrow(
        'boom',
      );
      expect(mockTransitionState).not.toHaveBeenCalled();
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
      mockTransitionState.mockResolvedValue(completedOperation);

      const result = await service.reject(tenantId, exchangeId);

      expect(mockCreateOperation).toHaveBeenCalledWith(
        expect.objectContaining({ type: OPERATION_TYPE.CREDENTIAL_REJECT }),
      );
      expect(mockRejectOffer).toHaveBeenCalledWith(externalId);
      expect(mockTransitionState).toHaveBeenCalledWith(
        'action-op-1',
        OperationState.COMPLETED,
        {},
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
      mockTransitionState.mockResolvedValue(failedOperation);

      const result = await service.reject(tenantId, exchangeId);

      expect(result).toBe(failedOperation);
    });
  });
});
