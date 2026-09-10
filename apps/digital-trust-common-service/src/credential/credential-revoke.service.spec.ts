import { ConnectorUnavailableError } from '@app/credential-ports';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { CredentialDefinitionFormat } from '../credential-definition/credential-definition.entity';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { Operation, OperationState } from '../operation/operation.entity';
import { OperationService } from '../operation/operation.service';

import { CredentialRevokeService } from './credential-revoke.service';
import { Credential, CredentialState } from './credential.entity';
import { CredentialRepository } from './credential.repository';

describe('CredentialRevokeService', () => {
  let service: CredentialRevokeService;
  let mockFindByIdForTenant: jest.Mock;
  let mockUpdateState: jest.Mock;
  let mockCreateOperation: jest.Mock;
  let mockTransitionState: jest.Mock;
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
    mockUpdateState = jest.fn().mockResolvedValue(undefined);
    mockCreateOperation = jest.fn();
    mockTransitionState = jest.fn();
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
            updateState: mockUpdateState,
          },
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

    service = module.get(CredentialRevokeService);

    mockResolve.mockResolvedValue({
      adapter: { revoke: mockRevoke },
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
    mockTransitionState.mockResolvedValue(completedOperation);

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
    expect(mockRevoke).toHaveBeenCalledWith(externalId);
    expect(mockUpdateState).toHaveBeenCalledWith(
      credentialId,
      CredentialState.REVOKED,
      { revokedAt: new Date('2024-01-02T00:00:00.000Z') },
    );
    expect(mockTransitionState).toHaveBeenCalledWith(
      'revoke-op-1',
      OperationState.COMPLETED,
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
    mockTransitionState.mockResolvedValue(failedOperation);

    const result = await service.revoke(tenantId, credentialId);

    expect(mockUpdateState).not.toHaveBeenCalled();
    expect(mockTransitionState).toHaveBeenCalledWith(
      'revoke-op-1',
      OperationState.FAILED,
      { code: 'REVOCATION_FAILED', message: 'ledger unavailable' },
    );
    expect(result).toBe(failedOperation);
  });

  it('transitions to failed on an AdapterError rather than throwing', async () => {
    mockFindByIdForTenant.mockResolvedValue(buildCredential());
    mockCreateOperation.mockResolvedValue(buildOperation());
    mockRevoke.mockRejectedValue(new ConnectorUnavailableError('down'));
    const failedOperation = buildOperation({ state: OperationState.FAILED });
    mockTransitionState.mockResolvedValue(failedOperation);

    const result = await service.revoke(tenantId, credentialId);

    expect(mockUpdateState).not.toHaveBeenCalled();
    expect(mockTransitionState).toHaveBeenCalledWith(
      'revoke-op-1',
      OperationState.FAILED,
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
    expect(mockTransitionState).not.toHaveBeenCalled();
  });
});
