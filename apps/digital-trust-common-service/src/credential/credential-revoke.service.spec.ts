import { ConnectorUnavailableError } from '@app/credential-ports';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { CredentialDefinitionFormat } from '../credential-definition/credential-definition.entity';
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
  let mockResolve: jest.Mock;
  let mockEmit: jest.Mock;
  let mockRevoke: jest.Mock;

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
    mockResolve = jest.fn();
    mockEmit = jest.fn().mockResolvedValue(undefined);
    mockRevoke = jest.fn();

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
          useValue: { findById: mockFindById },
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
    );
    expect(mockTransitionStateIfForward).toHaveBeenCalledWith(
      'revoke-op-1',
      OperationState.COMPLETED,
      operationStatesBelow(OperationState.COMPLETED),
      expect.objectContaining({ revoked: true }),
    );
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
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { state: OperationState.COMPLETED },
      }),
    );
    expect(result).toBe(alreadyCompleted);
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
