import {
  ConnectorUnavailableError,
  PresentationExchangeState,
} from '@app/credential-ports';
import { JOB_QUEUES } from '@app/pg-boss';
import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { Connection, ConnectionState } from '../connection/connection.entity';
import { ConnectionRepository } from '../connection/connection.repository';
import { CredentialDefinitionFormat } from '../credential-definition/credential-definition.entity';
import { JobsService } from '../jobs/jobs.service';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { Operation, OperationState } from '../operation/operation.entity';
import { OperationRepository } from '../operation/operation.repository';
import { OperationService } from '../operation/operation.service';
import {
  VerificationProfile,
  VerificationProfileStatus,
} from '../verification-profile/verification-profile.entity';
import { VerificationProfileRepository } from '../verification-profile/verification-profile.repository';

import { RequestPresentationDto } from './dto/request-presentation.dto';
import { PresentationRequestService } from './presentation-request.service';

describe('PresentationRequestService', () => {
  let service: PresentationRequestService;
  let mockFindProfileById: jest.Mock;
  let mockFindByNameAndVersion: jest.Mock;
  let mockFindConnectionById: jest.Mock;
  let mockFindOperationById: jest.Mock;
  let mockCreateOperation: jest.Mock;
  let mockTransitionStateIfForward: jest.Mock;
  let mockResolve: jest.Mock;
  let mockRequestPresentation: jest.Mock;
  let mockEmit: jest.Mock;
  let mockSendInTransaction: jest.Mock;
  let mockEventEmit: jest.Mock;
  let mockTransaction: jest.Mock;
  const mockManager = {} as EntityManager;

  const tenantId = '123e4567-e89b-12d3-a456-426614174001';
  const connectionId = '123e4567-e89b-12d3-a456-426614174002';
  const profileId = '123e4567-e89b-12d3-a456-426614174003';
  const createdAt = new Date('2024-01-01T00:00:00.000Z');

  const buildConnection = (overrides: Partial<Connection> = {}): Connection =>
    ({
      id: connectionId,
      tenantId,
      externalConnectionId: 'ext-conn-1',
      state: ConnectionState.ACTIVE,
      metadata: {},
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    }) as Connection;

  const buildProfile = (
    overrides: Partial<VerificationProfile> = {},
  ): VerificationProfile =>
    ({
      id: profileId,
      tenantId,
      name: 'age-verification',
      version: '1.0',
      presentationDefinition: {
        id: 'age-over-18',
        input_descriptors: [
          {
            id: 'age-check',
            constraints: { fields: [{ path: ['$.credentialSubject.age'] }] },
          },
        ],
      },
      requestedAttributes: ['age'],
      predicates: null,
      metadata: {},
      isPublic: false,
      status: VerificationProfileStatus.PUBLISHED,
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    }) as VerificationProfile;

  const buildOperation = (overrides: Partial<Operation> = {}): Operation =>
    ({
      id: 'presentation-op-1',
      tenantId,
      batchId: null,
      type: OPERATION_TYPE.PRESENTATION_REQUEST,
      state: OperationState.PENDING,
      request: { method: 'POST', path: '/presentations/request', body: {} },
      result: null,
      externalId: null,
      viewedAt: null,
      expiresAt: new Date('2024-01-04T00:00:00.000Z'),
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    }) as Operation;

  beforeEach(async () => {
    mockFindProfileById = jest.fn().mockResolvedValue(null);
    mockFindByNameAndVersion = jest.fn().mockResolvedValue(null);
    mockFindConnectionById = jest.fn().mockResolvedValue(buildConnection());
    mockFindOperationById = jest.fn();
    mockCreateOperation = jest.fn().mockResolvedValue(buildOperation());
    mockTransitionStateIfForward = jest.fn();
    mockResolve = jest.fn();
    mockRequestPresentation = jest.fn();
    mockEmit = jest.fn().mockResolvedValue(undefined);
    mockSendInTransaction = jest.fn().mockResolvedValue('job-1');
    mockEventEmit = jest.fn();
    mockTransaction = jest.fn(
      async (callback: (manager: EntityManager) => Promise<unknown>) =>
        callback(mockManager),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PresentationRequestService,
        {
          provide: VerificationProfileRepository,
          useValue: {
            findById: mockFindProfileById,
            findByNameAndVersion: mockFindByNameAndVersion,
          },
        },
        {
          provide: ConnectionRepository,
          useValue: { findById: mockFindConnectionById },
        },
        {
          provide: OperationRepository,
          useValue: { findById: mockFindOperationById },
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

    service = module.get(PresentationRequestService);
  });

  const buildDto = (
    overrides: Partial<RequestPresentationDto> = {},
  ): RequestPresentationDto => {
    const dto = new RequestPresentationDto();
    dto.connectionId = connectionId;
    Object.assign(dto, overrides);
    return dto;
  };

  it('rejects a request providing both verification_profile_id and presentation_definition', async () => {
    const dto = buildDto({
      verificationProfileId: profileId,
      presentationDefinition: { input_descriptors: [{ id: 'x' }] },
      format: CredentialDefinitionFormat.ANONCREDS,
    });

    await expect(service.requestPresentation(tenantId, dto)).rejects.toThrow(
      BadRequestException,
    );
    expect(mockCreateOperation).not.toHaveBeenCalled();
  });

  it('rejects a request providing neither verification_profile_id nor presentation_definition', async () => {
    const dto = buildDto();

    await expect(service.requestPresentation(tenantId, dto)).rejects.toThrow(
      BadRequestException,
    );
    expect(mockCreateOperation).not.toHaveBeenCalled();
  });

  it('rejects raw mode without connection_id (MVP is DIDComm-only, OID4VP unimplemented)', async () => {
    const dto = buildDto({
      connectionId: undefined,
      presentationDefinition: { input_descriptors: [{ id: 'x' }] },
      format: CredentialDefinitionFormat.ANONCREDS,
    });

    await expect(service.requestPresentation(tenantId, dto)).rejects.toThrow(
      BadRequestException,
    );
    expect(mockCreateOperation).not.toHaveBeenCalled();
  });

  it('rejects profile mode without connection_id (MVP is DIDComm-only, OID4VP unimplemented)', async () => {
    const dto = buildDto({
      connectionId: undefined,
      verificationProfileId: profileId,
    });

    await expect(service.requestPresentation(tenantId, dto)).rejects.toThrow(
      BadRequestException,
    );
    expect(mockCreateOperation).not.toHaveBeenCalled();
  });

  it('rejects raw mode missing format', async () => {
    const dto = buildDto({
      presentationDefinition: { input_descriptors: [{ id: 'x' }] },
    });

    await expect(service.requestPresentation(tenantId, dto)).rejects.toThrow(
      BadRequestException,
    );
    expect(mockCreateOperation).not.toHaveBeenCalled();
  });

  it('rejects a structurally invalid presentation_definition in raw mode', async () => {
    const dto = buildDto({
      presentationDefinition: { input_descriptors: [] },
      format: CredentialDefinitionFormat.ANONCREDS,
    });

    await expect(service.requestPresentation(tenantId, dto)).rejects.toThrow(
      BadRequestException,
    );
    expect(mockCreateOperation).not.toHaveBeenCalled();
  });

  it('rejects a non-published verification profile', async () => {
    mockFindProfileById.mockResolvedValue(
      buildProfile({ status: VerificationProfileStatus.DRAFT }),
    );

    const dto = buildDto({ verificationProfileId: profileId });

    await expect(service.requestPresentation(tenantId, dto)).rejects.toThrow(
      BadRequestException,
    );
    expect(mockCreateOperation).not.toHaveBeenCalled();
  });

  it('rejects a verification profile belonging to another tenant', async () => {
    mockFindProfileById.mockResolvedValue(
      buildProfile({ tenantId: 'other-tenant' }),
    );

    const dto = buildDto({ verificationProfileId: profileId });

    await expect(service.requestPresentation(tenantId, dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('resolves a profile by "name/version" string', async () => {
    mockFindByNameAndVersion.mockResolvedValue(buildProfile());
    mockResolve.mockResolvedValue({
      adapter: { requestPresentation: mockRequestPresentation },
      context: {},
      format: CredentialDefinitionFormat.ANONCREDS,
    });
    mockRequestPresentation.mockResolvedValue({
      id: 'exch-1',
      externalId: 'agent-exch-1',
      state: PresentationExchangeState.RequestSent,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    });
    mockTransitionStateIfForward.mockResolvedValue(
      buildOperation({ state: OperationState.PROCESSING }),
    );

    const dto = buildDto({
      verificationProfileId: 'age-verification/1.0',
    });

    await service.requestPresentation(tenantId, dto);

    expect(mockFindByNameAndVersion).toHaveBeenCalledWith(
      tenantId,
      'age-verification',
      '1.0',
    );
  });

  it('rejects a connection_id that does not belong to this tenant', async () => {
    mockFindConnectionById.mockResolvedValue(
      buildConnection({ tenantId: 'other-tenant' }),
    );

    const dto = buildDto({
      presentationDefinition: { input_descriptors: [{ id: 'x' }] },
      format: CredentialDefinitionFormat.ANONCREDS,
    });

    await expect(service.requestPresentation(tenantId, dto)).rejects.toThrow(
      BadRequestException,
    );
    expect(mockCreateOperation).not.toHaveBeenCalled();
  });

  it('rejects a missing connection_id row', async () => {
    mockFindConnectionById.mockResolvedValue(null);

    const dto = buildDto({
      presentationDefinition: { input_descriptors: [{ id: 'x' }] },
      format: CredentialDefinitionFormat.ANONCREDS,
    });

    await expect(service.requestPresentation(tenantId, dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('submits a raw-mode request and transitions the operation to processing', async () => {
    mockResolve.mockResolvedValue({
      adapter: { requestPresentation: mockRequestPresentation },
      context: { connectorId: 'connector-1' },
      format: CredentialDefinitionFormat.ANONCREDS,
    });
    mockRequestPresentation.mockResolvedValue({
      id: 'exch-1',
      externalId: 'agent-exch-1',
      state: PresentationExchangeState.RequestSent,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    });
    mockTransitionStateIfForward.mockResolvedValue(
      buildOperation({ state: OperationState.PROCESSING }),
    );

    const dto = buildDto({
      presentationDefinition: {
        id: 'ad-hoc-request',
        input_descriptors: [
          {
            id: 'age-check',
            constraints: { fields: [{ path: ['$.birth_date'] }] },
          },
        ],
      },
      format: CredentialDefinitionFormat.ANONCREDS,
    });

    const result = await service.requestPresentation(tenantId, dto);

    expect(mockRequestPresentation).toHaveBeenCalledWith(
      { connectorId: 'connector-1' },
      expect.objectContaining({
        connectionId,
        requestedAttributes: [{ name: 'birth_date' }],
      }),
    );
    expect(mockTransitionStateIfForward).toHaveBeenCalledWith(
      'presentation-op-1',
      OperationState.PROCESSING,
      expect.any(Array),
      expect.objectContaining({ id: 'exch-1' }),
      mockManager,
      'agent-exch-1',
    );
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.VERIFY }),
    );
    expect(result.state).toBe(OperationState.PROCESSING);
  });

  it('passes profile predicates through to the adapter, mapped to name/pType/pValue', async () => {
    mockFindProfileById.mockResolvedValue(
      buildProfile({
        predicates: [{ attribute: 'age', condition: '>=', value: '18' }],
      }),
    );
    mockResolve.mockResolvedValue({
      adapter: { requestPresentation: mockRequestPresentation },
      context: {},
      format: CredentialDefinitionFormat.ANONCREDS,
    });
    mockRequestPresentation.mockResolvedValue({
      id: 'exch-1',
      state: PresentationExchangeState.RequestSent,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    });
    mockTransitionStateIfForward.mockResolvedValue(
      buildOperation({ state: OperationState.PROCESSING }),
    );

    const dto = buildDto({ verificationProfileId: profileId });

    await service.requestPresentation(tenantId, dto);

    expect(mockRequestPresentation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        requestedPredicates: [{ name: 'age', pType: '>=', pValue: 18 }],
      }),
    );
  });

  it('marks the operation FAILED (not thrown) when the adapter rejects with an AdapterError', async () => {
    mockResolve.mockResolvedValue({
      adapter: { requestPresentation: mockRequestPresentation },
      context: {},
      format: CredentialDefinitionFormat.ANONCREDS,
    });
    mockRequestPresentation.mockRejectedValue(
      new ConnectorUnavailableError('agent unreachable'),
    );
    mockTransitionStateIfForward.mockResolvedValue(
      buildOperation({
        state: OperationState.FAILED,
        result: { code: 'CONNECTOR_UNAVAILABLE', message: 'agent unreachable' },
      }),
    );

    const dto = buildDto({
      presentationDefinition: { input_descriptors: [{ id: 'x' }] },
      format: CredentialDefinitionFormat.ANONCREDS,
    });

    const result = await service.requestPresentation(tenantId, dto);

    expect(result.state).toBe(OperationState.FAILED);
    expect(mockTransitionStateIfForward).toHaveBeenCalledWith(
      'presentation-op-1',
      OperationState.FAILED,
      expect.any(Array),
      { code: 'CONNECTOR_UNAVAILABLE', message: 'agent unreachable' },
      mockManager,
    );
    expect(mockSendInTransaction).toHaveBeenCalledWith(
      mockManager,
      JOB_QUEUES.WEBHOOK_DISPATCH,
      expect.objectContaining({ event: 'presentation.request.failed' }),
    );
    // Abandoned/failed outcomes carry no domain event, mirroring
    // PRESENT_PROOF_OUTCOMES.Abandoned having no `event`.
    expect(mockEventEmit).not.toHaveBeenCalled();
  });

  it('propagates a non-AdapterError from the adapter call', async () => {
    mockResolve.mockResolvedValue({
      adapter: { requestPresentation: mockRequestPresentation },
      context: {},
      format: CredentialDefinitionFormat.ANONCREDS,
    });
    mockRequestPresentation.mockRejectedValue(new Error('boom'));

    const dto = buildDto({
      presentationDefinition: { input_descriptors: [{ id: 'x' }] },
      format: CredentialDefinitionFormat.ANONCREDS,
    });

    await expect(service.requestPresentation(tenantId, dto)).rejects.toThrow(
      'boom',
    );
  });
});
