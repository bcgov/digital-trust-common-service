import {
  CredentialExchangeState,
  CredentialFormat as PortCredentialFormat,
  FormatValidatorRegistry,
  TimeoutError,
} from '@app/credential-ports';
import { JOB_QUEUES } from '@app/pg-boss';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { ConnectionService } from '../connection/connection.service';
import { CredentialDefinition } from '../credential-definition/credential-definition.entity';
import {
  CredentialDefinitionFormat,
  CredentialDefinitionConnectorType,
} from '../credential-definition/credential-definition.entity';
import { CredentialDefinitionRepository } from '../credential-definition/credential-definition.repository';
import { CredentialExchangeRepository } from '../credential-exchange/credential-exchange.repository';
import { CredentialExchangeService } from '../credential-exchange/credential-exchange.service';
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
  let mockResolveConnection: jest.Mock;
  let mockResolveIdentity: jest.Mock;
  let mockGetExchange: jest.Mock;
  let mockExchangeReconcile: jest.Mock;
  let mockCredentialFindByExternalId: jest.Mock;
  let mockExchangeObserve: jest.Mock;
  const mockMarkFailed = jest.fn();
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
      delivery: { protocol: 'didcomm-v1', connectionId },
      credential: { credentialSubject: { given_name: 'Alice' } },
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
      connectorId,
      registrationState: 'ready',
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
    mockResolveConnection = jest.fn().mockResolvedValue({
      id: connectionId,
      externalConnectionId: 'backend-connection',
    });
    mockResolveIdentity = jest.fn().mockResolvedValue({
      id: connectionId,
      externalConnectionId: 'backend-connection',
      state: 'abandoned',
    });
    mockGetExchange = jest.fn();
    mockExchangeReconcile = jest.fn().mockResolvedValue(undefined);
    mockMarkFailed.mockReset().mockResolvedValue(undefined);
    mockCredentialFindByExternalId = jest.fn();
    mockExchangeObserve = jest.fn().mockResolvedValue(undefined);
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
          provide: CredentialExchangeRepository,
          useValue: {
            create: jest.fn().mockResolvedValue({ id: 'local-exchange' }),
            observe: mockExchangeObserve,
            markFailed: mockMarkFailed,
          },
        },
        {
          provide: ConnectionService,
          useValue: {
            resolveForIssuance: mockResolveConnection,
            resolveIdentity: mockResolveIdentity,
          },
        },
        {
          provide: CredentialExchangeService,
          useValue: { reconcile: mockExchangeReconcile },
        },
        {
          provide: CredentialRepository,
          useValue: {
            create: mockCredentialCreate,
            updateStateIfForward: mockUpdateStateIfForward,
            setExternalId: mockSetExternalId,
            findByExternalId: mockCredentialFindByExternalId,
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
          useValue: {
            findById: mockOperationFindById,
            findByIdForTenant: mockOperationFindById,
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
      adapter: {
        offerCredential: mockOfferCredential,
        getExchange: mockGetExchange,
      },
      connector: { id: connectorId },
      context: { connectorId, tenantId },
      format: PortCredentialFormat.AnonCreds,
    });
  });

  describe('MVP DIDComm-only guard', () => {
    it('throws 400 when connection_id is missing', async () => {
      await expect(
        service.offer(tenantId, buildDto({ delivery: undefined })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });
  });

  describe('normalized subject and connection validation', () => {
    it.each([
      { options: undefined, expected: true },
      { options: {}, expected: true },
      { options: { autoIssue: true }, expected: true },
      { options: { autoIssue: false }, expected: false },
    ])('forwards auto issuance options %p', async ({ options, expected }) => {
      await service.offer(tenantId, buildDto({ options }));
      expect(mockOfferCredential).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ autoIssue: expected }),
      );
      expect(mockCreateOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.objectContaining({
            body: expect.objectContaining(
              options === undefined
                ? {}
                : { options: { auto_issue: expected } },
            ),
          }),
        }),
        expect.anything(),
      );
    });

    it.each([null, {}, [], ['value'], NaN, Infinity, -Infinity])(
      'rejects non-scalar AnonCreds claim %p',
      async (value) => {
        await expect(
          service.offer(
            tenantId,
            buildDto({
              credential: { credentialSubject: { given_name: value } },
            }),
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(mockCreateOperation).not.toHaveBeenCalled();
        expect(mockOfferCredential).not.toHaveBeenCalled();
      },
    );

    it('maps finite numbers and booleans to preview strings without dropping false or zero', async () => {
      await service.offer(
        tenantId,
        buildDto({
          credential: {
            credentialSubject: {
              given_name: 'Alice',
              active: false,
              count: 0,
              score: 1.25,
            },
          },
        }),
      );
      expect(mockOfferCredential).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          attributes: [
            { name: 'family_name', value: 'Doe' },
            { name: 'given_name', value: 'Alice' },
            { name: 'active', value: 'false' },
            { name: 'count', value: '0' },
            { name: 'score', value: '1.25' },
          ],
        }),
      );
    });

    it('does not create records or submit an offer when connection resolution fails', async () => {
      mockResolveConnection.mockRejectedValue(new NotFoundException());
      await expect(service.offer(tenantId, buildDto())).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockCreateOperation).not.toHaveBeenCalled();
      expect(mockOfferCredential).not.toHaveBeenCalled();
    });
  });

  describe('reconcile', () => {
    beforeEach(() => {
      mockOperationFindById.mockResolvedValue(
        buildOperation({ externalId, exchangeId: 'local-exchange' }),
      );
    });

    it('delegates correlated observation and returns the refreshed tenant operation', async () => {
      const updated = buildOperation({
        externalId,
        exchangeId: 'local-exchange',
        state: OperationState.COMPLETED,
      });
      mockOperationFindById
        .mockResolvedValueOnce(
          buildOperation({ externalId, exchangeId: 'local-exchange' }),
        )
        .mockResolvedValueOnce(updated);
      expect(await service.reconcile(tenantId, operationId)).toBe(updated);
      expect(mockOperationFindById).toHaveBeenNthCalledWith(
        1,
        operationId,
        tenantId,
      );
      expect(mockOperationFindById).toHaveBeenNthCalledWith(
        2,
        operationId,
        tenantId,
      );
      expect(mockExchangeReconcile).toHaveBeenCalledWith(
        tenantId,
        'local-exchange',
      );
      expect(mockGetExchange).not.toHaveBeenCalled();
      expect(mockOfferCredential).not.toHaveBeenCalled();
    });

    it('hides another tenant operation', async () => {
      mockOperationFindById.mockResolvedValue(null);
      await expect(
        service.reconcile(tenantId, operationId),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockExchangeReconcile).not.toHaveBeenCalled();
    });

    it('refuses unknown submission outcomes instead of resending', async () => {
      mockOperationFindById.mockResolvedValue(
        buildOperation({ exchangeId: null }),
      );
      await expect(
        service.reconcile(tenantId, operationId),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockExchangeReconcile).not.toHaveBeenCalled();
      expect(mockOfferCredential).not.toHaveBeenCalled();
    });

    it('does not reconcile an operation of another type', async () => {
      mockOperationFindById.mockResolvedValue(
        buildOperation({ type: OPERATION_TYPE.CREDENTIAL_ACCEPT, externalId }),
      );
      await expect(
        service.reconcile(tenantId, operationId),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockExchangeReconcile).not.toHaveBeenCalled();
    });

    it('reports a concurrently purged operation after observation', async () => {
      mockOperationFindById
        .mockResolvedValueOnce(
          buildOperation({ externalId, exchangeId: 'local-exchange' }),
        )
        .mockResolvedValueOnce(null);
      await expect(
        service.reconcile(tenantId, operationId),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockExchangeReconcile).toHaveBeenCalledTimes(1);
      expect(mockOfferCredential).not.toHaveBeenCalled();
    });

    it.each([
      new TimeoutError('Read timed out'),
      new ConflictException('Backend credential exchange was not found'),
      new ConflictException('Exchange holder correlation is inconsistent'),
    ])(
      'propagates observation errors without resubmitting: %p',
      async (error) => {
        mockExchangeReconcile.mockRejectedValue(error);
        await expect(service.reconcile(tenantId, operationId)).rejects.toBe(
          error,
        );
        expect(mockOfferCredential).not.toHaveBeenCalled();
      },
    );
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
    it.each(['unverified', 'pending', 'failed'] as const)(
      'rejects a %s definition without creating an operation',
      async (registrationState) => {
        mockCredentialDefinitionFindById.mockResolvedValue({
          ...buildCredentialDefinition(),
          registrationState,
        });
        await expect(service.offer(tenantId, buildDto())).rejects.toThrow(
          BadRequestException,
        );
        expect(mockCreateOperation).not.toHaveBeenCalled();
      },
    );

    it('rejects a profile whose connector does not own the definition', async () => {
      mockProfileFindById.mockResolvedValue(
        buildProfile({ connectorId: 'other-wallet' }),
      );
      await expect(service.offer(tenantId, buildDto())).rejects.toThrow(
        BadRequestException,
      );
      expect(mockCreateOperation).not.toHaveBeenCalled();
    });
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
        buildDto({
          credential: { credentialSubject: { given_name: 'Alice' } },
        }),
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
      });

    it('infers format from the stored definition', async () => {
      await service.offer(tenantId, legacyDto());
      expect(mockOfferCredential).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          format: PortCredentialFormat.AnonCreds,
          connectionId: 'backend-connection',
          credentialDefinitionId: externalCredentialDefinitionId,
        }),
      );
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

    it('resolves the credential definition directly with no profile defaults', async () => {
      await service.offer(tenantId, legacyDto());

      expect(mockProfileFindById).not.toHaveBeenCalled();
      expect(mockResolveAdapter).toHaveBeenCalledWith(
        tenantId,
        PortCredentialFormat.AnonCreds,
        { connectorId },
      );
      expect(mockCredentialCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          issuanceProfileId: null,
          metadata: { credentialDefinitionId },
        }),
        mockManager,
      );
    });
  });

  describe('registration readiness', () => {
    it.each(['unverified', 'pending', 'failed'] as const)(
      'rejects a %s definition before creating an offer',
      async (registrationState) => {
        mockCredentialDefinitionFindById.mockResolvedValue(
          buildCredentialDefinition({ registrationState }),
        );
        await expect(service.offer(tenantId, buildDto())).rejects.toThrow(
          'Credential definition is not ready for issuance',
        );
        expect(mockCreateOperation).not.toHaveBeenCalled();
        expect(mockOfferCredential).not.toHaveBeenCalled();
      },
    );

    it('rejects a definition without an external identifier', async () => {
      mockCredentialDefinitionFindById.mockResolvedValue(
        buildCredentialDefinition({ externalId: null }),
      );
      await expect(service.offer(tenantId, buildDto())).rejects.toThrow(
        'Credential definition is not ready for issuance',
      );
      expect(mockOfferCredential).not.toHaveBeenCalled();
    });

    it('rejects a profile bound to another issuer wallet', async () => {
      mockProfileFindById.mockResolvedValue(
        buildProfile({ connectorId: 'another-connector' }),
      );
      await expect(service.offer(tenantId, buildDto())).rejects.toThrow(
        'Profile connector does not own this credential definition',
      );
      expect(mockOfferCredential).not.toHaveBeenCalled();
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
    it.each([true, false])(
      'notifies a synchronous holder request only when its exchange advances (%s)',
      async (advanced) => {
        mockCreateOperation.mockResolvedValue(
          buildOperation({ exchangeId: 'local-exchange' }),
        );
        mockOfferCredential.mockResolvedValue({
          id: externalId,
          externalId,
          state: CredentialExchangeState.RequestReceived,
          format: PortCredentialFormat.AnonCreds,
          attributes: [],
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
        });
        mockExchangeObserve.mockResolvedValue(
          advanced
            ? {
                exchangeId: 'local-exchange',
                from: 'pending',
                to: CredentialExchangeState.RequestReceived,
              }
            : null,
        );

        const result = await service.offer(tenantId, buildDto());

        if (advanced) {
          expect(mockSendInTransaction).toHaveBeenCalledWith(
            mockManager,
            JOB_QUEUES.WEBHOOK_DISPATCH,
            expect.objectContaining({
              tenantId,
              event: 'credential-exchange.request-received',
              resourceId: 'local-exchange',
            }),
          );
          expect(mockSendInTransaction).toHaveBeenCalledTimes(1);
        } else {
          expect(mockSendInTransaction).not.toHaveBeenCalled();
        }
        expect(result.state).toBe(OperationState.PROCESSING);
        expect(mockEventEmit).not.toHaveBeenCalled();
      },
    );

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

    it('records the sent offer on its linked durable exchange', async () => {
      mockCreateOperation.mockResolvedValue(
        buildOperation({ exchangeId: 'local-exchange' }),
      );
      mockOfferCredential.mockResolvedValue({
        id: 'exchange-1',
        externalId,
        state: CredentialExchangeState.OfferSent,
        format: PortCredentialFormat.AnonCreds,
        attributes: [],
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
      });

      await service.offer(tenantId, buildDto());

      expect(mockExchangeObserve).toHaveBeenCalledWith(
        tenantId,
        connectorId,
        externalId,
        CredentialExchangeState.OfferSent,
        mockManager,
        'local-exchange',
      );
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

    it('marks the linked durable exchange failed with the operation', async () => {
      mockCreateOperation.mockResolvedValue(
        buildOperation({ exchangeId: 'local-exchange' }),
      );
      mockOfferCredential.mockRejectedValue(
        new TimeoutError('agent unreachable'),
      );
      mockTransitionStateIfForward.mockResolvedValue(
        buildOperation({ state: OperationState.FAILED }),
      );

      await service.offer(tenantId, buildDto());

      expect(mockMarkFailed).toHaveBeenCalledWith(
        tenantId,
        'local-exchange',
        mockManager,
      );
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
