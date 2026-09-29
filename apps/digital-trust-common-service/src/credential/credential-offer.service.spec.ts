import {
  CredentialExchangeState,
  CredentialFormat as PortCredentialFormat,
  FormatValidatorRegistry,
  TimeoutError,
} from '@app/credential-ports';
import { JOB_QUEUES } from '@app/pg-boss';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { CredentialDefinition } from '../credential-definition/credential-definition.entity';
import {
  CredentialDefinitionFormat,
  CredentialDefinitionConnectorType,
} from '../credential-definition/credential-definition.entity';
import { CredentialDefinitionRepository } from '../credential-definition/credential-definition.repository';
import {
  IssuanceProfile,
  IssuanceProfileProtocolHint,
  IssuanceProfileStatus,
} from '../issuance-profile/issuance-profile.entity';
import { IssuanceProfileRepository } from '../issuance-profile/issuance-profile.repository';
import { JobsService } from '../jobs/jobs.service';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { Operation, OperationState } from '../operation/operation.entity';
import { OperationRepository } from '../operation/operation.repository';
import { OperationService } from '../operation/operation.service';
import {
  credentialStatesBelow,
  operationStatesBelow,
} from '../protocol-state-change/state-mapping';

import { CredentialOfferService } from './credential-offer.service';
import { Credential, CredentialState } from './credential.entity';
import { CredentialRepository } from './credential.repository';
import { OfferCredentialRequestDto } from './dto/offer-credential-request.dto';

describe('CredentialOfferService', () => {
  let service: CredentialOfferService;
  let mockCredentialCreate: jest.Mock;
  let mockUpdateStateIfForward: jest.Mock;
  let mockSetExternalId: jest.Mock;
  let mockCredentialDefinitionFindById: jest.Mock;
  let mockProfileFindById: jest.Mock;
  let mockProfileFindByNameAndVersion: jest.Mock;
  let mockCreateOperation: jest.Mock;
  let mockTransitionStateIfForward: jest.Mock;
  let mockOperationFindById: jest.Mock;
  let mockResolveAdapter: jest.Mock;
  let mockOfferCredential: jest.Mock;
  let mockHas: jest.Mock;
  let mockValidatorResolve: jest.Mock;
  let mockValidateAttributes: jest.Mock;
  let mockEmit: jest.Mock;
  let mockSendInTransaction: jest.Mock;
  let mockEventEmit: jest.Mock;
  let mockTransaction: jest.Mock;
  const mockManager = {} as EntityManager;

  const tenantId = '123e4567-e89b-12d3-a456-426614174001';
  const profileId = '123e4567-e89b-12d3-a456-426614174010';
  const credentialDefinitionId = '123e4567-e89b-12d3-a456-426614174011';
  const externalCredentialDefinitionId = 'cred-def-external-123';
  const connectionId = '123e4567-e89b-12d3-a456-426614174012';
  const connectorId = '123e4567-e89b-12d3-a456-426614174013';
  const operationId = 'offer-op-1';
  const credentialId = 'cred-1';
  const externalId = 'agent-exchange-1';
  const createdAt = new Date('2024-01-01T00:00:00.000Z');

  const buildDto = (
    overrides: Partial<OfferCredentialRequestDto> = {},
  ): OfferCredentialRequestDto =>
    Object.assign(new OfferCredentialRequestDto(), {
      profileId,
      connectionId,
      attributes: { given_name: 'Alice' },
      ...overrides,
    });

  const buildCredentialDefinition = (
    overrides: Partial<CredentialDefinition> = {},
  ): CredentialDefinition =>
    ({
      id: credentialDefinitionId,
      tenantId,
      name: 'Diploma',
      format: CredentialDefinitionFormat.ANONCREDS,
      schemaDefinition: { attr_names: ['given_name'] },
      externalId: externalCredentialDefinitionId,
      connectorType: CredentialDefinitionConnectorType.TRACTION,
      isActive: true,
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    }) as CredentialDefinition;

  const buildProfile = (
    overrides: Partial<IssuanceProfile> = {},
  ): IssuanceProfile =>
    ({
      id: profileId,
      tenantId,
      name: 'diploma',
      version: '1.0',
      credentialDefinitionId,
      format: CredentialDefinitionFormat.ANONCREDS,
      connectorId,
      attributeSchema: {},
      defaults: { family_name: 'Doe' },
      metadata: {},
      protocolHint: IssuanceProfileProtocolHint.AUTO,
      status: IssuanceProfileStatus.PUBLISHED,
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    }) as IssuanceProfile;

  const buildOperation = (overrides: Partial<Operation> = {}): Operation =>
    ({
      id: operationId,
      tenantId,
      batchId: null,
      type: OPERATION_TYPE.CREDENTIAL_OFFER,
      state: OperationState.PENDING,
      request: { method: 'POST', path: '/offer', body: {} },
      result: null,
      externalId: null,
      viewedAt: null,
      expiresAt: new Date('2024-01-04T00:00:00.000Z'),
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    }) as Operation;

  const buildCredential = (overrides: Partial<Credential> = {}): Credential =>
    ({
      id: credentialId,
      tenantId,
      issuanceProfileId: profileId,
      connectionId,
      connectorId,
      externalId: null,
      format: CredentialDefinitionFormat.ANONCREDS,
      state: CredentialState.OFFERED,
      operationId,
      metadata: {},
      issuedAt: null,
      revokedAt: null,
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    }) as Credential;

  beforeEach(async () => {
    mockCredentialCreate = jest.fn();
    mockUpdateStateIfForward = jest.fn().mockResolvedValue(true);
    mockSetExternalId = jest.fn().mockResolvedValue(undefined);
    mockCredentialDefinitionFindById = jest.fn();
    mockProfileFindById = jest.fn();
    mockProfileFindByNameAndVersion = jest.fn();
    mockCreateOperation = jest.fn();
    mockTransitionStateIfForward = jest.fn();
    mockOperationFindById = jest.fn();
    mockOfferCredential = jest.fn().mockResolvedValue({
      id: 'exchange-id-default',
      state: CredentialExchangeState.OfferSent,
    });
    mockResolveAdapter = jest.fn();
    mockHas = jest.fn().mockReturnValue(false);
    mockValidateAttributes = jest.fn().mockReturnValue([]);
    mockValidatorResolve = jest
      .fn()
      .mockReturnValue({ validateAttributes: mockValidateAttributes });
    mockEmit = jest.fn().mockResolvedValue(undefined);
    mockSendInTransaction = jest.fn().mockResolvedValue('job-1');
    mockEventEmit = jest.fn();
    mockTransaction = jest.fn(
      async (callback: (manager: EntityManager) => Promise<unknown>) =>
        callback(mockManager),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialOfferService,
        {
          provide: CredentialRepository,
          useValue: {
            create: mockCredentialCreate,
            updateStateIfForward: mockUpdateStateIfForward,
            setExternalId: mockSetExternalId,
          },
        },
        {
          provide: CredentialDefinitionRepository,
          useValue: { findById: mockCredentialDefinitionFindById },
        },
        {
          provide: IssuanceProfileRepository,
          useValue: {
            findById: mockProfileFindById,
            findByNameAndVersion: mockProfileFindByNameAndVersion,
          },
        },
        {
          provide: OperationRepository,
          useValue: { findById: mockOperationFindById },
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
          useValue: { resolve: mockResolveAdapter },
        },
        {
          provide: FormatValidatorRegistry,
          useValue: { has: mockHas, resolve: mockValidatorResolve },
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

    service = module.get(CredentialOfferService);

    mockProfileFindById.mockResolvedValue(buildProfile());
    mockCredentialDefinitionFindById.mockResolvedValue(
      buildCredentialDefinition(),
    );
    mockCreateOperation.mockResolvedValue(buildOperation());
    mockTransitionStateIfForward.mockResolvedValue(
      buildOperation({ state: OperationState.PROCESSING }),
    );
    mockCredentialCreate.mockResolvedValue(buildCredential());
    mockResolveAdapter.mockResolvedValue({
      adapter: { offerCredential: mockOfferCredential },
      connector: { id: connectorId },
      context: { connectorId, tenantId },
      format: PortCredentialFormat.AnonCreds,
    });
  });

  describe('MVP DIDComm-only guard', () => {
    it('throws 400 when connection_id is missing', async () => {
      await expect(
        service.offer(tenantId, buildDto({ connectionId: undefined })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });
  });

  describe('profile_id / credential_definition_id resolution', () => {
    it('throws 400 when neither profile_id nor credential_definition_id is provided', async () => {
      await expect(
        service.offer(tenantId, buildDto({ profileId: undefined })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });

    it('throws 400 when both profile_id and credential_definition_id are provided', async () => {
      await expect(
        service.offer(
          tenantId,
          buildDto({
            credentialDefinitionId,
            format: CredentialDefinitionFormat.ANONCREDS,
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });

    it('throws 400 when profile_id has no slash and is not a valid UUID', async () => {
      await expect(
        service.offer(tenantId, buildDto({ profileId: 'not-a-uuid' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockProfileFindById).not.toHaveBeenCalled();
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });

    it('resolves profile_id by name/version when it contains a slash', async () => {
      mockProfileFindByNameAndVersion.mockResolvedValue(buildProfile());

      await service.offer(tenantId, buildDto({ profileId: 'diploma/1.0' }));

      expect(mockProfileFindByNameAndVersion).toHaveBeenCalledWith(
        tenantId,
        'diploma',
        '1.0',
      );
      expect(mockProfileFindById).not.toHaveBeenCalled();
    });
  });

  describe('profile mode', () => {
    it('throws 400 when the profile is not found', async () => {
      mockProfileFindById.mockResolvedValue(null);

      await expect(service.offer(tenantId, buildDto())).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });

    it('throws 400 when the profile belongs to another tenant', async () => {
      mockProfileFindById.mockResolvedValue(
        buildProfile({ tenantId: 'other-tenant' }),
      );

      await expect(service.offer(tenantId, buildDto())).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws 400 when the profile is still draft', async () => {
      mockProfileFindById.mockResolvedValue(
        buildProfile({ status: IssuanceProfileStatus.DRAFT }),
      );

      await expect(service.offer(tenantId, buildDto())).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });

    it('throws 400 when the profile has been deprecated', async () => {
      mockProfileFindById.mockResolvedValue(
        buildProfile({ status: IssuanceProfileStatus.DEPRECATED }),
      );

      await expect(service.offer(tenantId, buildDto())).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });

    it('throws 400 when the profile references a credential definition that is no longer active', async () => {
      mockCredentialDefinitionFindById.mockResolvedValue(null);

      await expect(service.offer(tenantId, buildDto())).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });

    it('merges profile defaults into submitted attributes before validating', async () => {
      mockHas.mockReturnValue(true);

      await service.offer(
        tenantId,
        buildDto({ attributes: { given_name: 'Alice' } }),
      );

      expect(mockValidateAttributes).toHaveBeenCalledWith(
        { attr_names: ['given_name'] },
        expect.arrayContaining([
          { name: 'given_name', value: 'Alice' },
          { name: 'family_name', value: 'Doe' },
        ]),
      );
    });
  });

  describe('legacy credential_definition_id mode', () => {
    const legacyDto = (): OfferCredentialRequestDto =>
      buildDto({
        profileId: undefined,
        credentialDefinitionId,
        format: CredentialDefinitionFormat.ANONCREDS,
      });

    it('throws 400 when format is missing', async () => {
      await expect(
        service.offer(
          tenantId,
          buildDto({ profileId: undefined, credentialDefinitionId }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockCredentialDefinitionFindById).not.toHaveBeenCalled();
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });

    it('throws 404 when the credential definition is not found', async () => {
      mockCredentialDefinitionFindById.mockResolvedValue(null);

      await expect(service.offer(tenantId, legacyDto())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws 404 when the credential definition belongs to another tenant', async () => {
      mockCredentialDefinitionFindById.mockResolvedValue(
        buildCredentialDefinition({ tenantId: 'other-tenant' }),
      );

      await expect(service.offer(tenantId, legacyDto())).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws 400 when the given format does not match the credential definition', async () => {
      await expect(
        service.offer(
          tenantId,
          buildDto({
            profileId: undefined,
            credentialDefinitionId,
            format: CredentialDefinitionFormat.MDL,
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('resolves the credential definition directly with no profile defaults', async () => {
      await service.offer(tenantId, legacyDto());

      expect(mockProfileFindById).not.toHaveBeenCalled();
      expect(mockCredentialCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          issuanceProfileId: null,
          metadata: { credentialDefinitionId },
        }),
        mockManager,
      );
    });
  });

  describe('attribute + format validation', () => {
    it('throws 400 when the resolved format has no port mapping', async () => {
      mockProfileFindById.mockResolvedValue(
        buildProfile({ format: CredentialDefinitionFormat.SD_JWT }),
      );
      mockCredentialDefinitionFindById.mockResolvedValue(
        buildCredentialDefinition({
          format: CredentialDefinitionFormat.SD_JWT,
        }),
      );

      await expect(service.offer(tenantId, buildDto())).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });

    it('throws 400 when attribute validation fails', async () => {
      mockHas.mockReturnValue(true);
      mockValidateAttributes.mockReturnValue([
        { path: 'given_name', message: 'is required' },
      ]);

      await expect(service.offer(tenantId, buildDto())).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });

    it('skips attribute validation entirely for a format with no registered validator', async () => {
      mockHas.mockReturnValue(false);

      await service.offer(tenantId, buildDto());

      expect(mockValidatorResolve).not.toHaveBeenCalled();
      expect(mockCreateOperation).toHaveBeenCalled();
    });
  });

  describe('adapter pre-flight resolution', () => {
    it('throws 400 when the adapter registry cannot resolve a connector', async () => {
      mockResolveAdapter.mockRejectedValue(
        new TimeoutError('no connector configured'),
      );

      await expect(service.offer(tenantId, buildDto())).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });

    it('propagates an unexpected error from the adapter registry as-is', async () => {
      const unexpected = new Error('boom');
      mockResolveAdapter.mockRejectedValue(unexpected);

      await expect(service.offer(tenantId, buildDto())).rejects.toBe(
        unexpected,
      );
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });
  });

  describe('successful submission', () => {
    it('creates the Operation and Credential and sends the external (not local) credential definition id to the adapter', async () => {
      mockOfferCredential.mockResolvedValue({
        id: 'exchange-1',
        externalId,
        state: CredentialExchangeState.OfferSent,
        format: PortCredentialFormat.AnonCreds,
        attributes: [],
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
      });
      mockTransitionStateIfForward.mockResolvedValue(
        buildOperation({ state: OperationState.PROCESSING, externalId }),
      );

      const result = await service.offer(tenantId, buildDto());

      expect(mockCreateOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          type: OPERATION_TYPE.CREDENTIAL_OFFER,
        }),
        mockManager,
      );
      expect(mockCredentialCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          issuanceProfileId: profileId,
          connectionId,
          connectorId,
          format: CredentialDefinitionFormat.ANONCREDS,
          state: CredentialState.OFFERED,
          operationId,
        }),
        mockManager,
      );
      expect(mockOfferCredential).toHaveBeenCalledWith(
        expect.objectContaining({ connectorId, tenantId }),
        expect.objectContaining({
          credentialDefinitionId: externalCredentialDefinitionId,
        }),
      );
      // The still-in-flight (offer-sent) outcome has no guarded credential
      // transition to piggy-back externalId onto, so it must go through
      // setExternalId instead, and no webhook/event fires prematurely.
      expect(mockSetExternalId).toHaveBeenCalledWith(
        credentialId,
        tenantId,
        externalId,
        mockManager,
      );
      expect(mockUpdateStateIfForward).not.toHaveBeenCalled();
      expect(mockSendInTransaction).not.toHaveBeenCalled();
      expect(mockEventEmit).not.toHaveBeenCalled();
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          action: AuditAction.ISSUE,
          resourceType: 'credential',
          resourceId: credentialId,
        }),
      );
      expect(result.state).toBe(OperationState.PROCESSING);
    });

    it('completes synchronously, transitions the credential to ISSUED, dispatches the webhook and emits the domain event when won', async () => {
      mockOfferCredential.mockResolvedValue({
        id: 'exchange-1',
        externalId,
        state: CredentialExchangeState.CredentialIssued,
        format: PortCredentialFormat.AnonCreds,
        attributes: [],
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
      });
      const completedOperation = buildOperation({
        state: OperationState.COMPLETED,
        externalId,
      });
      mockTransitionStateIfForward.mockResolvedValue(completedOperation);

      const result = await service.offer(tenantId, buildDto());

      expect(mockUpdateStateIfForward).toHaveBeenCalledWith(
        credentialId,
        tenantId,
        CredentialState.ISSUED,
        credentialStatesBelow(CredentialState.ISSUED),
        expect.objectContaining({ externalId }),
        mockManager,
      );
      expect(mockSendInTransaction).toHaveBeenCalledWith(
        mockManager,
        JOB_QUEUES.WEBHOOK_DISPATCH,
        expect.objectContaining({ tenantId, event: 'credential.issued' }),
      );
      expect(mockEventEmit).toHaveBeenCalledWith('credential.issued', {
        tenantId,
        externalId,
      });
      expect(result).toBe(completedOperation);
    });

    it('does not fire the webhook or domain event when a concurrent delivery already won the transition', async () => {
      mockOfferCredential.mockResolvedValue({
        id: 'exchange-1',
        externalId,
        state: CredentialExchangeState.CredentialIssued,
        format: PortCredentialFormat.AnonCreds,
        attributes: [],
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
      });
      mockTransitionStateIfForward.mockResolvedValue(null);
      const alreadySettled = buildOperation({
        state: OperationState.COMPLETED,
        externalId,
      });
      mockOperationFindById.mockResolvedValue(alreadySettled);

      const result = await service.offer(tenantId, buildDto());

      expect(mockSendInTransaction).not.toHaveBeenCalled();
      expect(mockEventEmit).not.toHaveBeenCalled();
      expect(result).toBe(alreadySettled);
    });
  });

  describe('adapter error handling', () => {
    it('guards the transition to FAILED, dispatches a failure webhook and emits audit, without rethrowing', async () => {
      const adapterError = new TimeoutError('agent unreachable');
      mockOfferCredential.mockRejectedValue(adapterError);
      const failedOperation = buildOperation({ state: OperationState.FAILED });
      mockTransitionStateIfForward.mockResolvedValue(failedOperation);

      const result = await service.offer(tenantId, buildDto());

      expect(mockTransitionStateIfForward).toHaveBeenCalledWith(
        operationId,
        OperationState.FAILED,
        operationStatesBelow(OperationState.FAILED),
        expect.objectContaining({ code: adapterError.code }),
        mockManager,
      );
      expect(mockUpdateStateIfForward).toHaveBeenCalledWith(
        credentialId,
        tenantId,
        CredentialState.FAILED,
        credentialStatesBelow(CredentialState.FAILED),
        {},
        mockManager,
      );
      expect(mockSendInTransaction).toHaveBeenCalledWith(
        mockManager,
        JOB_QUEUES.WEBHOOK_DISPATCH,
        expect.objectContaining({
          tenantId,
          event: 'credential.offer.failed',
        }),
      );
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          action: AuditAction.ISSUE,
          resourceType: 'credential',
          resourceId: credentialId,
        }),
      );
      expect(result).toBe(failedOperation);
    });

    it('propagates a non-adapter error from the adapter call untouched', async () => {
      const unexpected = new Error('socket hang up');
      mockOfferCredential.mockRejectedValue(unexpected);

      await expect(service.offer(tenantId, buildDto())).rejects.toBe(
        unexpected,
      );
      expect(mockTransitionStateIfForward).not.toHaveBeenCalled();
    });
  });
});
