import { ConnectorUnavailableError } from '@app/credential-ports';
import { JOB_QUEUES } from '@app/pg-boss';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { CredentialDefinitionFormat } from '../credential-definition/credential-definition.entity';
import { JobsService } from '../jobs/jobs.service';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { Operation, OperationState } from '../operation/operation.entity';
import { OperationRepository } from '../operation/operation.repository';
import { OperationService } from '../operation/operation.service';
import {
  credentialStatesBelow,
  operationStatesBelow,
} from '../protocol-state-change/state-mapping';

import { CredentialRevokeService } from './credential-revoke.service';
import { Credential, CredentialState } from './credential.entity';
import { CredentialRepository } from './credential.repository';

describe('CredentialRevokeService', () => {
  let service: CredentialRevokeService;
  let mockFindByIdForTenant: jest.Mock;
  let mockUpdateStateIfForward: jest.Mock;
  let mockCreateOperation: jest.Mock;
  let mockTransitionStateIfForward: jest.Mock;
  let mockFindById: jest.Mock;
  let mockFindByExternalIdForTenant: jest.Mock;
  let mockFindLatestByExternalIdAndTypeForTenant: jest.Mock;
  let mockResolve: jest.Mock;
  let mockEmit: jest.Mock;
  let mockRevoke: jest.Mock;
  let mockSendInTransaction: jest.Mock;
  let mockEventEmit: jest.Mock;
  let mockTransaction: jest.Mock;
  const mockManager = {} as EntityManager;

  const tenantId = '123e4567-e89b-12d3-a456-426614174001';
  const credentialId = '123e4567-e89b-12d3-a456-426614174000';
  const connectorId = '123e4567-e89b-12d3-a456-426614174002';
  const externalId = 'agent-cred-123';
  const createdAt = new Date('2024-01-01T00:00:00.000Z');

  const buildCredential = (overrides: Partial<Credential> = {}): Credential =>
    ({
      id: credentialId,
      tenantId,
      connectorId,
      externalId,
      format: CredentialDefinitionFormat.ANONCREDS,
      state: CredentialState.ISSUED,
      operationId: 'offer-op-1',
      metadata: {},
      issuedAt: createdAt,
      revokedAt: null,
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    }) as Credential;

  const buildOperation = (overrides: Partial<Operation> = {}): Operation =>
    ({
      id: 'revoke-op-1',
      tenantId,
      batchId: null,
      type: OPERATION_TYPE.CREDENTIAL_REVOKE,
      state: OperationState.PENDING,
      request: { method: 'POST', path: '/revoke', body: {} },
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
    mockUpdateStateIfForward = jest.fn().mockResolvedValue(true);
    mockCreateOperation = jest.fn();
    mockTransitionStateIfForward = jest.fn();
    mockFindById = jest.fn();
    mockFindByExternalIdForTenant = jest.fn().mockResolvedValue(null);
    mockFindLatestByExternalIdAndTypeForTenant = jest.fn();
    mockResolve = jest.fn();
    mockEmit = jest.fn().mockResolvedValue(undefined);
    mockRevoke = jest.fn();
    mockSendInTransaction = jest.fn().mockResolvedValue('job-1');
    mockEventEmit = jest.fn();
    mockTransaction = jest.fn(
      async (callback: (manager: EntityManager) => Promise<unknown>) =>
        callback(mockManager),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialRevokeService,
        {
          provide: CredentialRepository,
          useValue: {
            findByIdForTenant: mockFindByIdForTenant,
            updateStateIfForward: mockUpdateStateIfForward,
          },
        },
        {
          provide: OperationRepository,
          useValue: {
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
          provide: JobsService,
          useValue: { sendInTransaction: mockSendInTransaction },
        },
        {
          provide: EventEmitter2,
          useValue: { emit: mockEventEmit },
        },
        {
          provide: DataSource,
          useValue: { transaction: mockTransaction },
        },
      ],
    }).compile();

    service = module.get(CredentialRevokeService);

    mockResolve.mockResolvedValue({
      adapter: { revoke: mockRevoke },
      context: {
        connectorId,
        tenantId,
        endpointUrl: 'https://agent.example.com',
        credentials: { apiKey: 'secret' },
      },
    });
  });

  it('throws 404 when the credential is not found for the tenant', async () => {
    mockFindByIdForTenant.mockResolvedValue(null);

    await expect(service.revoke(tenantId, credentialId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(mockCreateOperation).not.toHaveBeenCalled();
  });

  it('throws 400 when the credential format does not support revocation', async () => {
    mockFindByIdForTenant.mockResolvedValue(
      buildCredential({ format: CredentialDefinitionFormat.SD_JWT }),
    );

    await expect(service.revoke(tenantId, credentialId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mockCreateOperation).not.toHaveBeenCalled();
  });

  it('throws 400 when the credential has no externalId', async () => {
    mockFindByIdForTenant.mockResolvedValue(
      buildCredential({ externalId: null }),
    );

    await expect(service.revoke(tenantId, credentialId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mockCreateOperation).not.toHaveBeenCalled();
  });

  it('returns an already in-flight PROCESSING revoke operation instead of creating a duplicate', async () => {
    mockFindByIdForTenant.mockResolvedValue(buildCredential());
    const existingInFlight = buildOperation({
      id: 'revoke-op-existing',
      state: OperationState.PROCESSING,
    });
    mockFindByExternalIdForTenant.mockResolvedValue(existingInFlight);

    const result = await service.revoke(tenantId, credentialId);

    expect(mockFindByExternalIdForTenant).toHaveBeenCalledWith(
      tenantId,
      externalId,
      [OPERATION_TYPE.CREDENTIAL_REVOKE],
    );
    expect(mockCreateOperation).not.toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
    expect(result).toBe(existingInFlight);
  });

  it('retries the adapter call against a durable PENDING in-flight revoke operation instead of creating a duplicate', async () => {
    mockFindByIdForTenant.mockResolvedValue(buildCredential());
    const stalePending = buildOperation({
      id: 'revoke-op-existing',
      state: OperationState.PENDING,
    });
    mockFindByExternalIdForTenant.mockResolvedValue(stalePending);
    mockRevoke.mockResolvedValue({
      credentialId: externalId,
      revoked: true,
      revokedAt: '2024-01-02T00:00:00.000Z',
    });
    const completedOperation = buildOperation({
      id: 'revoke-op-existing',
      state: OperationState.COMPLETED,
    });
    mockTransitionStateIfForward.mockResolvedValue(completedOperation);

    const result = await service.revoke(tenantId, credentialId);

    expect(mockCreateOperation).not.toHaveBeenCalled();
    expect(mockResolve).toHaveBeenCalledWith(tenantId, undefined, {
      connectorId,
    });
    expect(mockTransitionStateIfForward).toHaveBeenCalledWith(
      'revoke-op-existing',
      OperationState.COMPLETED,
      operationStatesBelow(OperationState.COMPLETED),
      expect.objectContaining({ revoked: true }),
      mockManager,
    );
    expect(result).toBe(completedOperation);
  });

  it('returns the concurrent winner when createOperation loses the atomic claim (unique violation)', async () => {
    mockFindByIdForTenant.mockResolvedValue(buildCredential());
    const winner = buildOperation({
      id: 'revoke-op-winner',
      state: OperationState.PROCESSING,
    });
    mockFindByExternalIdForTenant.mockResolvedValueOnce(null);
    mockFindLatestByExternalIdAndTypeForTenant.mockResolvedValue(winner);
    mockCreateOperation.mockRejectedValue(
      Object.assign(new Error('duplicate key value'), {
        driverError: { code: '23505' },
      }),
    );

    const result = await service.revoke(tenantId, credentialId);

    expect(mockFindLatestByExternalIdAndTypeForTenant).toHaveBeenCalledWith(
      tenantId,
      externalId,
      OPERATION_TYPE.CREDENTIAL_REVOKE,
    );
    expect(mockResolve).not.toHaveBeenCalled();
    expect(result).toBe(winner);
  });

  it('retries the adapter call when the unique-violation winner is itself still PENDING', async () => {
    mockFindByIdForTenant.mockResolvedValue(buildCredential());
    const pendingWinner = buildOperation({
      id: 'revoke-op-winner',
      state: OperationState.PENDING,
    });
    mockFindByExternalIdForTenant.mockResolvedValueOnce(null);
    mockFindLatestByExternalIdAndTypeForTenant.mockResolvedValue(pendingWinner);
    mockCreateOperation.mockRejectedValue(
      Object.assign(new Error('duplicate key value'), {
        driverError: { code: '23505' },
      }),
    );
    mockRevoke.mockResolvedValue({
      credentialId: externalId,
      revoked: true,
      revokedAt: '2024-01-02T00:00:00.000Z',
    });
    const completedOperation = buildOperation({
      id: 'revoke-op-winner',
      state: OperationState.COMPLETED,
    });
    mockTransitionStateIfForward.mockResolvedValue(completedOperation);

    const result = await service.revoke(tenantId, credentialId);

    expect(mockResolve).toHaveBeenCalledWith(tenantId, undefined, {
      connectorId,
    });
    expect(mockTransitionStateIfForward).toHaveBeenCalledWith(
      'revoke-op-winner',
      OperationState.COMPLETED,
      operationStatesBelow(OperationState.COMPLETED),
      expect.objectContaining({ revoked: true }),
      mockManager,
    );
    expect(result).toBe(completedOperation);
  });

  it('propagates a createOperation error that is not a unique violation', async () => {
    mockFindByIdForTenant.mockResolvedValue(buildCredential());
    const dbError = new Error('connection terminated');
    mockCreateOperation.mockRejectedValue(dbError);

    await expect(service.revoke(tenantId, credentialId)).rejects.toBe(dbError);
    expect(mockFindLatestByExternalIdAndTypeForTenant).not.toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('propagates the original unique-violation error when no winner can be found', async () => {
    mockFindByIdForTenant.mockResolvedValue(buildCredential());
    const raceError = Object.assign(new Error('duplicate key value'), {
      driverError: { code: '23505' },
    });
    mockFindByExternalIdForTenant.mockResolvedValueOnce(null);
    mockFindLatestByExternalIdAndTypeForTenant.mockResolvedValue(null);
    mockCreateOperation.mockRejectedValue(raceError);

    await expect(service.revoke(tenantId, credentialId)).rejects.toBe(
      raceError,
    );
  });

  it('completes synchronously and updates the credential when the adapter confirms revocation', async () => {
    mockFindByIdForTenant.mockResolvedValue(buildCredential());
    mockCreateOperation.mockResolvedValue(buildOperation());
    mockRevoke.mockResolvedValue({
      credentialId: externalId,
      revoked: true,
      revokedAt: '2024-01-02T00:00:00.000Z',
    });
    const completedOperation = buildOperation({
      state: OperationState.COMPLETED,
    });
    mockTransitionStateIfForward.mockResolvedValue(completedOperation);

    const result = await service.revoke(tenantId, credentialId);

    expect(mockCreateOperation).toHaveBeenCalledWith({
      tenantId,
      type: OPERATION_TYPE.CREDENTIAL_REVOKE,
      request: {
        method: 'POST',
        path: `/api/v1/tenants/${tenantId}/credentials/${credentialId}/revoke`,
        body: {},
      },
      externalId,
    });
    expect(mockResolve).toHaveBeenCalledWith(tenantId, undefined, {
      connectorId,
    });
    expect(mockRevoke).toHaveBeenCalledWith(
      expect.objectContaining({ connectorId }),
      externalId,
    );
    expect(mockUpdateStateIfForward).toHaveBeenCalledWith(
      credentialId,
      tenantId,
      CredentialState.REVOKED,
      credentialStatesBelow(CredentialState.REVOKED),
      { revokedAt: new Date('2024-01-02T00:00:00.000Z') },
      mockManager,
    );
    expect(mockTransitionStateIfForward).toHaveBeenCalledWith(
      'revoke-op-1',
      OperationState.COMPLETED,
      operationStatesBelow(OperationState.COMPLETED),
      expect.objectContaining({ revoked: true }),
      mockManager,
    );
    // Same row-lock order as ProtocolStateChangeService.process() (Operation
    // before Credential) — reversing it is how two concurrent transactions
    // touching both rows would deadlock instead of one cleanly losing.
    expect(
      mockTransitionStateIfForward.mock.invocationCallOrder[0],
    ).toBeLessThan(mockUpdateStateIfForward.mock.invocationCallOrder[0]);
    expect(mockSendInTransaction).toHaveBeenCalledWith(
      mockManager,
      JOB_QUEUES.WEBHOOK_DISPATCH,
      expect.objectContaining({
        tenantId,
        event: 'credential.revoked',
        resourceId: externalId,
      }),
    );
    expect(mockEventEmit).toHaveBeenCalledWith('credential.revoked', {
      tenantId,
      externalId,
    });
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        action: AuditAction.REVOKE,
        resourceType: 'credential',
        resourceId: credentialId,
      }),
    );
    expect(result).toBe(completedOperation);
  });

  it('transitions to failed when the adapter reports revoked: false', async () => {
    mockFindByIdForTenant.mockResolvedValue(buildCredential());
    mockCreateOperation.mockResolvedValue(buildOperation());
    mockRevoke.mockResolvedValue({
      credentialId: externalId,
      revoked: false,
      error: 'ledger unavailable',
    });
    const failedOperation = buildOperation({ state: OperationState.FAILED });
    mockTransitionStateIfForward.mockResolvedValue(failedOperation);

    const result = await service.revoke(tenantId, credentialId);

    expect(mockUpdateStateIfForward).not.toHaveBeenCalled();
    expect(mockTransitionStateIfForward).toHaveBeenCalledWith(
      'revoke-op-1',
      OperationState.FAILED,
      operationStatesBelow(OperationState.FAILED),
      { code: 'REVOCATION_FAILED', message: 'ledger unavailable' },
      mockManager,
    );
    expect(mockSendInTransaction).toHaveBeenCalledWith(
      mockManager,
      JOB_QUEUES.WEBHOOK_DISPATCH,
      expect.objectContaining({
        tenantId,
        event: 'credential.revoke.failed',
        resourceId: externalId,
      }),
    );
    expect(result).toBe(failedOperation);
  });

  it('transitions to failed on an AdapterError rather than throwing', async () => {
    mockFindByIdForTenant.mockResolvedValue(buildCredential());
    mockCreateOperation.mockResolvedValue(buildOperation());
    mockRevoke.mockRejectedValue(new ConnectorUnavailableError('down'));
    const failedOperation = buildOperation({ state: OperationState.FAILED });
    mockTransitionStateIfForward.mockResolvedValue(failedOperation);

    const result = await service.revoke(tenantId, credentialId);

    expect(mockUpdateStateIfForward).not.toHaveBeenCalled();
    expect(mockTransitionStateIfForward).toHaveBeenCalledWith(
      'revoke-op-1',
      OperationState.FAILED,
      operationStatesBelow(OperationState.FAILED),
      { code: 'CONNECTOR_UNAVAILABLE', message: 'down' },
      mockManager,
    );
    expect(mockSendInTransaction).toHaveBeenCalledWith(
      mockManager,
      JOB_QUEUES.WEBHOOK_DISPATCH,
      expect.objectContaining({
        tenantId,
        event: 'credential.revoke.failed',
        resourceId: externalId,
      }),
    );
    expect(result).toBe(failedOperation);
  });

  it('propagates an unexpected (non-adapter) error', async () => {
    mockFindByIdForTenant.mockResolvedValue(buildCredential());
    mockCreateOperation.mockResolvedValue(buildOperation());
    mockRevoke.mockRejectedValue(new Error('boom'));

    await expect(service.revoke(tenantId, credentialId)).rejects.toThrow(
      'boom',
    );
    expect(mockTransitionStateIfForward).not.toHaveBeenCalled();
  });

  it('does not regress or duplicate when the protocol worker already completed the operation first', async () => {
    mockFindByIdForTenant.mockResolvedValue(buildCredential());
    mockCreateOperation.mockResolvedValue(buildOperation());
    mockRevoke.mockResolvedValue({
      credentialId: externalId,
      revoked: true,
      revokedAt: '2024-01-02T00:00:00.000Z',
    });
    mockTransitionStateIfForward.mockResolvedValue(null);
    const alreadyCompleted = buildOperation({
      state: OperationState.COMPLETED,
    });
    mockFindById.mockResolvedValue(alreadyCompleted);

    const result = await service.revoke(tenantId, credentialId);

    expect(mockFindById).toHaveBeenCalledWith('revoke-op-1');
    // The Operation guard is checked first now, so a loss must never even
    // attempt the Credential row.
    expect(mockUpdateStateIfForward).not.toHaveBeenCalled();
    expect(mockSendInTransaction).not.toHaveBeenCalled();
    expect(mockEventEmit).not.toHaveBeenCalled();
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { state: OperationState.COMPLETED },
      }),
    );
    expect(result).toBe(alreadyCompleted);
  });

  it('rolls back the Operation transition when the credential is no longer revocable despite winning its own guard', async () => {
    mockFindByIdForTenant.mockResolvedValue(buildCredential());
    mockCreateOperation.mockResolvedValue(buildOperation());
    mockRevoke.mockResolvedValue({
      credentialId: externalId,
      revoked: true,
      revokedAt: '2024-01-02T00:00:00.000Z',
    });
    mockTransitionStateIfForward.mockResolvedValue(
      buildOperation({ state: OperationState.COMPLETED }),
    );
    mockUpdateStateIfForward.mockResolvedValue(false);

    await expect(service.revoke(tenantId, credentialId)).rejects.toThrow(
      /not in a revocable state/,
    );

    expect(mockSendInTransaction).not.toHaveBeenCalled();
    expect(mockEventEmit).not.toHaveBeenCalled();
  });

  it('does not regress an already-completed operation to failed when the protocol worker won the failure race first', async () => {
    mockFindByIdForTenant.mockResolvedValue(buildCredential());
    mockCreateOperation.mockResolvedValue(buildOperation());
    mockRevoke.mockRejectedValue(new ConnectorUnavailableError('down'));
    mockTransitionStateIfForward.mockResolvedValue(null);
    const alreadyCompleted = buildOperation({
      state: OperationState.COMPLETED,
    });
    mockFindById.mockResolvedValue(alreadyCompleted);

    const result = await service.revoke(tenantId, credentialId);

    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { state: OperationState.COMPLETED },
      }),
    );
    expect(result).toBe(alreadyCompleted);
  });

  it('throws 404 if the operation vanished after losing the race', async () => {
    mockFindByIdForTenant.mockResolvedValue(buildCredential());
    mockCreateOperation.mockResolvedValue(buildOperation());
    mockRevoke.mockRejectedValue(new ConnectorUnavailableError('down'));
    mockTransitionStateIfForward.mockResolvedValue(null);
    mockFindById.mockResolvedValue(null);

    await expect(service.revoke(tenantId, credentialId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
