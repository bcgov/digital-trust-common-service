import {
  CredentialFormat,
  FormatNotSupportedError,
  FormatValidatorRegistry,
} from '@app/credential-ports';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AxiosError, AxiosHeaders } from 'axios';
import { DataSource, QueryFailedError } from 'typeorm';

import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { RegistrationBackendError } from '../common/registration-backend-error';
import { JobsService } from '../jobs/jobs.service';
import { OperationService } from '../operation/operation.service';
import { TenantStatus } from '../tenant/tenant.entity';

import { CREDENTIAL_DEFINITION_FORMAT_HANDLERS } from './credential-definition-format-handler';
import {
  CredentialDefinition,
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
} from './credential-definition.entity';
import { CredentialDefinitionRepository } from './credential-definition.repository';
import {
  CredentialDefinitionService,
  toPortCredentialFormat,
} from './credential-definition.service';
import { CreateCredentialDefinitionDto } from './dto/create-credential-definition.dto';

describe('CredentialDefinitionService', () => {
  let service: CredentialDefinitionService;
  let mockCreate: jest.Mock;
  let mockFindById: jest.Mock;
  let mockFindByTenantId: jest.Mock;
  let mockFindExistingByTenantAndNameAndFormat: jest.Mock;
  let mockFindByTenantAndNameAndFormat: jest.Mock;
  let mockFindByFormat: jest.Mock;
  let mockFindByConnector: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockDeactivate: jest.Mock;
  let mockEmit: jest.Mock;
  let mockHas: jest.Mock;
  let mockResolve: jest.Mock;
  let mockValidateSchema: jest.Mock;
  const manager = {
    save: jest.fn(),
    query: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const register = {
    resolveIssuer: jest.fn(),
    resolveSchema: jest.fn(),
  };
  const resolveAdapter = jest.fn();
  const createOperation = jest.fn();
  const computeExpiresAt = jest.fn();
  const transitionState = jest.fn();
  const enqueue = jest.fn();
  const anonCredsHandler = {
    format: CredentialDefinitionFormat.ANONCREDS,
    normalizeOptions: jest.fn((options: Record<string, unknown> = {}) => {
      const revocation = options.revocation as
        { enabled?: boolean } | undefined;
      return {
        tag: options.tag ?? 'default',
        revocation: { enabled: revocation?.enabled ?? true },
      };
    }),
    prepare: jest.fn(
      async (tenantId: string, dto: CreateCredentialDefinitionDto) => {
        if (
          !dto.schema ||
          (dto.schema.id !== undefined) ===
            (dto.schema.definition !== undefined)
        ) {
          throw new BadRequestException(
            'Supply schema.id or schema.definition, not both',
          );
        }
        if (
          dto.issuer &&
          (dto.issuer.id !== undefined) === (dto.issuer.method !== undefined)
        ) {
          throw new BadRequestException(
            'Supply issuer.id or issuer.method, not both',
          );
        }
        const resolved = await resolveAdapter(
          tenantId,
          CredentialFormat.AnonCreds,
          {
            connectorId: dto.connectorId,
          },
        );
        if (!resolved.adapter.definitionRegistration) {
          throw new BadRequestException(
            'Connector does not support artifact registration',
          );
        }
        const issuerId = await register.resolveIssuer(
          resolved.context,
          dto.issuer,
        );
        const schema = dto.schema.id
          ? await register.resolveSchema(resolved.context, dto.schema.id)
          : { id: undefined, definition: dto.schema.definition ?? {} };
        const connectorType = Object.values(
          CredentialDefinitionConnectorType,
        ).find((type) => type === resolved.connector.connectorType);
        if (!connectorType) {
          throw new BadRequestException('Unknown registration connector type');
        }
        return {
          connectorId: resolved.connector.id,
          connectorType,
          schemaDefinition: schema.definition,
          registration: {
            issuerId,
            schema: schema.id ? { id: schema.id, state: 'finished' } : {},
            definition: {},
          },
        };
      },
    ),
    register: jest.fn(
      async (definition: CredentialDefinition, managerArg: typeof manager) => {
        await enqueue(
          managerArg,
          'credential-definition.register',
          {
            tenantId: definition.tenantId,
            definitionId: definition.id,
          },
          { singletonKey: definition.id },
        );
      },
    ),
  };
  const noRegistrationHandler = {
    format: CredentialDefinitionFormat.SD_JWT,
    normalizeOptions: jest.fn(
      (options: Record<string, unknown> = {}) => options,
    ),
    prepare: jest.fn(
      async (tenantId: string, dto: CreateCredentialDefinitionDto) => {
        const resolved = await resolveAdapter(tenantId, undefined, {
          connectorId: dto.connectorId,
        });
        return {
          connectorId: resolved.connector.id,
          connectorType: CredentialDefinitionConnectorType.TRACTION,
          schemaDefinition: dto.schema.definition ?? { id: dto.schema.id },
          registration: null,
        };
      },
    ),
    register: jest.fn((definition: CredentialDefinition) => {
      definition.registrationState = 'ready';
    }),
  };

  const mockCredentialDefinition: CredentialDefinition = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    tenantId: '123e4567-e89b-12d3-a456-426614174001',
    name: 'Test Credential',
    format: CredentialDefinitionFormat.ANONCREDS,
    schemaDefinition: { schema: 'test' },
    externalId: 'external-123',
    connectorType: CredentialDefinitionConnectorType.TRACTION,
    isActive: true,
    metadata: { key: 'value' },
    createdAt: new Date(),
    updatedAt: new Date(),
    tenant: {
      id: '123e4567-e89b-12d3-a456-426614174001',
      name: 'Test Tenant',
      slug: 'test-tenant',
      description: 'A test tenant',
      status: TenantStatus.ACTIVE,
      config: {},
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: new Date(),
    },
  };

  const auth = {
    sub: 'user-1',
    tokenType: 'user' as const,
    clientId: 'spa',
    tenantId: mockCredentialDefinition.tenantId,
    roles: [] as string[],
    scope: 'tenants:admin',
    scopes: ['tenants:admin'],
    iss: 'http://localhost/oidc',
    aud: 'http://localhost/oidc',
    exp: 9_999_999_999,
    iat: 1,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCreate = jest.fn();
    mockFindById = jest.fn();
    mockFindByTenantId = jest.fn();
    mockFindExistingByTenantAndNameAndFormat = jest.fn();
    mockFindByTenantAndNameAndFormat = mockFindExistingByTenantAndNameAndFormat;
    mockFindByFormat = jest.fn();
    mockFindByConnector = jest.fn();
    mockUpdate = jest.fn();
    mockDeactivate = jest.fn();
    mockEmit = jest.fn().mockResolvedValue(undefined);
    mockValidateSchema = jest.fn().mockReturnValue([]);
    mockResolve = jest
      .fn()
      .mockReturnValue({ validateSchema: mockValidateSchema });
    mockHas = jest.fn().mockReturnValue(false);
    resolveAdapter.mockResolvedValue({
      connector: { id: 'connector-1', connectorType: 'traction' },
      context: {},
      adapter: { definitionRegistration: register },
    });
    register.resolveIssuer.mockResolvedValue('did:indy:issuer');
    register.resolveSchema.mockResolvedValue({
      id: 'schema-1',
      definition: mockCredentialDefinition.schemaDefinition,
    });
    createOperation.mockResolvedValue({ id: 'operation-1', state: 'pending' });
    computeExpiresAt.mockReturnValue(new Date('2030-01-01T00:00:00.000Z'));
    mockCreate.mockResolvedValue(mockCredentialDefinition);
    mockFindByTenantAndNameAndFormat.mockResolvedValue(null);
    mockFindExistingByTenantAndNameAndFormat.mockResolvedValue(null);
    manager.findOne.mockResolvedValue(null);
    enqueue.mockResolvedValue('job-1');
    transitionState.mockResolvedValue({
      id: 'operation-1',
      state: 'completed',
    });

    const mockRepository = {
      create: mockCreate,
      findById: mockFindById,
      findByTenantId: mockFindByTenantId,
      findExistingByTenantAndNameAndFormat:
        mockFindExistingByTenantAndNameAndFormat,
      findByFormat: mockFindByFormat,
      findByConnector: mockFindByConnector,
      update: mockUpdate,
      updateEditableFields: mockUpdate,
      deactivate: mockDeactivate,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialDefinitionService,
        {
          provide: OperationService,
          useValue: { createOperation, computeExpiresAt, transitionState },
        },
        { provide: JobsService, useValue: { sendInTransaction: enqueue } },
        {
          provide: DataSource,
          useValue: {
            transaction: async (
              fn: (value: typeof manager) => Promise<unknown>,
            ) => fn(manager),
          },
        },
        {
          provide: CredentialDefinitionRepository,
          useValue: mockRepository,
        },
        {
          provide: DomainAuditService,
          useValue: { emit: mockEmit },
        },
        {
          provide: FormatValidatorRegistry,
          useValue: { has: mockHas, resolve: mockResolve },
        },
        {
          provide: CREDENTIAL_DEFINITION_FORMAT_HANDLERS,
          useValue: [anonCredsHandler, noRegistrationHandler],
        },
      ],
    }).compile();

    service = module.get<CredentialDefinitionService>(
      CredentialDefinitionService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('reports sanitized preflight rejection using the existing HTTP error envelope', async () => {
      register.resolveIssuer.mockRejectedValueOnce(
        new RegistrationBackendError(
          400,
          'INVALID_ISSUER',
          'Issuer is not registered',
        ),
      );
      await expect(
        service.create(
          auth.tenantId,
          {
            name: 'Employee',
            format: CredentialDefinitionFormat.ANONCREDS,
            schema: { definition: mockCredentialDefinition.schemaDefinition },
          },
          auth,
        ),
      ).rejects.toMatchObject({
        response: {
          code: 'REGISTRATION_BACKEND_REJECTED',
          backend_status: 400,
          backend_code: 'INVALID_ISSUER',
          message: 'Issuer is not registered',
        },
      });
      expect(enqueue).not.toHaveBeenCalled();
    });

    const sameDefinition = (
      overrides: Partial<CredentialDefinition> = {},
    ): CredentialDefinition => ({
      ...mockCredentialDefinition,
      connectorId: 'connector-1',
      registrationState: 'pending',
      registrationOperationId: 'existing-operation',
      options: { tag: 'default', revocation: { enabled: true } },
      registration: {
        issuerId: 'did:indy:issuer',
        schema: {},
        definition: {},
      },
      ...overrides,
    });

    it('queues one keyed continuation and returns the pending operation', async () => {
      mockFindExistingByTenantAndNameAndFormat.mockResolvedValueOnce(
        sameDefinition(),
      );
      manager.findOne.mockResolvedValue({
        id: 'existing-operation',
        state: 'processing',
      });

      const result = await service.create(
        auth.tenantId,
        {
          name: 'Employee',
          format: CredentialDefinitionFormat.ANONCREDS,
          schema: { definition: mockCredentialDefinition.schemaDefinition },
        },
        auth,
      );

      expect(result).toEqual({
        id: 'existing-operation',
        state: 'processing',
      });
      expect(enqueue).toHaveBeenCalledWith(
        manager,
        'credential-definition.register',
        { tenantId: auth.tenantId, definitionId: mockCredentialDefinition.id },
        { singletonKey: mockCredentialDefinition.id },
      );
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('returns an existing completed operation without queueing or auditing', async () => {
      mockFindExistingByTenantAndNameAndFormat.mockResolvedValueOnce(
        sameDefinition({
          registrationState: 'ready',
          registrationOperationId: 'completed-operation',
        }),
      );
      manager.findOne.mockResolvedValue({
        id: 'completed-operation',
        state: 'completed',
      });

      await expect(
        service.create(
          auth.tenantId,
          {
            name: 'Employee',
            format: CredentialDefinitionFormat.ANONCREDS,
            schema: { definition: mockCredentialDefinition.schemaDefinition },
            metadata: { changed: true },
          },
          auth,
        ),
      ).resolves.toEqual({ id: 'completed-operation', state: 'completed' });
      expect(enqueue).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('creates a new operation and continues a failed registration from saved progress', async () => {
      const failed = sameDefinition({
        registrationState: 'failed',
        registrationOperationId: 'failed-operation',
        registration: {
          issuerId: 'did:indy:issuer',
          schema: { transactionId: 'saved-transaction', state: 'wait' },
          definition: {},
        },
      });
      mockFindExistingByTenantAndNameAndFormat.mockResolvedValueOnce(failed);
      createOperation.mockResolvedValueOnce({
        id: 'continued-operation',
        state: 'pending',
      });

      const result = await service.create(
        auth.tenantId,
        {
          name: 'Employee',
          format: CredentialDefinitionFormat.ANONCREDS,
          schema: { definition: mockCredentialDefinition.schemaDefinition },
        },
        auth,
      );

      expect(manager.update).toHaveBeenCalledWith(
        CredentialDefinition,
        { id: failed.id, tenantId: auth.tenantId },
        expect.objectContaining({
          isActive: true,
          registrationState: 'pending',
          registrationOperationId: 'continued-operation',
        }),
      );
      expect(failed.registration?.schema.transactionId).toBe(
        'saved-transaction',
      );
      expect(enqueue).toHaveBeenCalledWith(
        manager,
        'credential-definition.register',
        { tenantId: auth.tenantId, definitionId: failed.id },
        { singletonKey: failed.id },
      );
      expect(result.id).toBe('continued-operation');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('rejects replay of a deactivated ready definition', async () => {
      mockFindExistingByTenantAndNameAndFormat.mockResolvedValueOnce(
        sameDefinition({
          isActive: false,
          registrationState: 'ready',
        }),
      );
      await expect(
        service.create(
          auth.tenantId,
          {
            name: 'Other name',
            format: CredentialDefinitionFormat.ANONCREDS,
            schema: { definition: mockCredentialDefinition.schemaDefinition },
          },
          auth,
        ),
      ).rejects.toMatchObject({
        response: { code: 'REGISTRATION_REPLAY_UNAVAILABLE' },
      });
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('should create a new credential definition if name is unique for tenant', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      const dto: CreateCredentialDefinitionDto = {
        name: mockCredentialDefinition.name,
        format: mockCredentialDefinition.format,
        schema: { definition: mockCredentialDefinition.schemaDefinition },
        metadata: mockCredentialDefinition.metadata,
        options: {
          tag: 'department',
          revocation: { enabled: false },
        },
      };

      mockFindByTenantAndNameAndFormat.mockResolvedValue(null);
      mockCreate.mockResolvedValue(mockCredentialDefinition);

      const result = await service.create(tenantId, dto, auth);

      expect(mockFindByTenantAndNameAndFormat).toHaveBeenCalledWith(
        tenantId,
        dto.name,
        dto.format,
        manager,
      );
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          name: dto.name,
          format: dto.format,
          schemaDefinition: dto.schema.definition,
          externalId: null,
          connectorId: 'connector-1',
          registrationState: 'pending',
          registration: {
            issuerId: 'did:indy:issuer',
            schema: {},
            definition: {},
          },
          options: { tag: 'department', revocation: { enabled: false } },
          metadata: dto.metadata,
        }),
        manager,
      );
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: mockCredentialDefinition.tenantId,
        action: AuditAction.CREATE,
        resourceType: 'credential_definition',
        resourceId: mockCredentialDefinition.id,
      });
      expect(result).toEqual(expect.objectContaining({ id: 'operation-1' }));
    });

    it('should throw ConflictException if name already exists for tenant', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      const dto: CreateCredentialDefinitionDto = {
        name: mockCredentialDefinition.name,
        format: mockCredentialDefinition.format,
        schema: { definition: mockCredentialDefinition.schemaDefinition },
        metadata: mockCredentialDefinition.metadata,
      };

      mockFindByTenantAndNameAndFormat.mockResolvedValue(
        mockCredentialDefinition,
      );

      await expect(service.create(tenantId, dto, auth)).rejects.toThrow(
        ConflictException,
      );
      expect(mockFindByTenantAndNameAndFormat).toHaveBeenCalledWith(
        tenantId,
        dto.name,
        dto.format,
        manager,
      );
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('creates formats without a registration step as ready', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      const dto: CreateCredentialDefinitionDto = {
        name: mockCredentialDefinition.name,
        format: CredentialDefinitionFormat.SD_JWT,
        schema: { definition: mockCredentialDefinition.schemaDefinition },
        metadata: mockCredentialDefinition.metadata,
      };

      mockFindByTenantAndNameAndFormat.mockResolvedValue(null);
      mockCreate.mockResolvedValue(mockCredentialDefinition);

      await service.create(tenantId, dto, auth);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          format: CredentialDefinitionFormat.SD_JWT,
          registrationState: 'pending',
          registration: null,
          options: {},
        }),
        manager,
      );
      expect(noRegistrationHandler.register).toHaveBeenCalled();
      expect(transitionState).toHaveBeenCalledWith(
        'operation-1',
        'completed',
        { credential_definition_id: mockCredentialDefinition.id },
        manager,
        tenantId,
      );
    });

    it('skips schema validation when a mapped format has no registered validator', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      const dto: CreateCredentialDefinitionDto = {
        name: mockCredentialDefinition.name,
        format: CredentialDefinitionFormat.ANONCREDS,
        schema: { definition: mockCredentialDefinition.schemaDefinition },
        metadata: mockCredentialDefinition.metadata,
      };

      mockFindByTenantAndNameAndFormat.mockResolvedValue(null);
      mockCreate.mockResolvedValue(mockCredentialDefinition);
      mockHas.mockReturnValue(false);

      await service.create(tenantId, dto, auth);

      expect(mockHas).toHaveBeenCalledWith(CredentialFormat.AnonCreds);
      expect(mockResolve).not.toHaveBeenCalled();
      expect(mockCreate).toHaveBeenCalled();
    });

    it('validates the schema when a validator is registered and it is valid', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      const dto: CreateCredentialDefinitionDto = {
        name: mockCredentialDefinition.name,
        format: CredentialDefinitionFormat.ANONCREDS,
        schema: { definition: mockCredentialDefinition.schemaDefinition },
        metadata: mockCredentialDefinition.metadata,
      };

      mockFindByTenantAndNameAndFormat.mockResolvedValue(null);
      mockCreate.mockResolvedValue(mockCredentialDefinition);
      mockHas.mockReturnValue(true);
      mockValidateSchema.mockReturnValue([]);

      await service.create(tenantId, dto, auth);

      expect(mockHas).toHaveBeenCalledWith(CredentialFormat.AnonCreds);
      expect(mockResolve).toHaveBeenCalledWith(CredentialFormat.AnonCreds);
      expect(mockValidateSchema).toHaveBeenCalledWith(dto.schema.definition);
      expect(mockCreate).toHaveBeenCalled();
    });

    it('throws BadRequestException when the schema fails format validation', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      const dto: CreateCredentialDefinitionDto = {
        name: mockCredentialDefinition.name,
        format: CredentialDefinitionFormat.ANONCREDS,
        schema: { definition: mockCredentialDefinition.schemaDefinition },
        metadata: mockCredentialDefinition.metadata,
      };
      const issues = [{ path: 'attr_names', message: 'is required' }];

      mockFindByTenantAndNameAndFormat.mockResolvedValue(null);
      mockHas.mockReturnValue(true);
      mockValidateSchema.mockReturnValue(issues);

      await expect(service.create(tenantId, dto, auth)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('resolves imported schemas and permits explicitly non-revocable definitions', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      const dto: CreateCredentialDefinitionDto = {
        name: mockCredentialDefinition.name,
        format: CredentialDefinitionFormat.ANONCREDS,
        schema: { id: 'schema-1' },
        issuer: { method: 'indy' },
        options: { revocation: { enabled: false } },
        metadata: {
          revocation: { enabled: false },
          issuer: 'DMV',
        },
      };

      mockFindByTenantAndNameAndFormat.mockResolvedValue(null);
      mockHas.mockReturnValue(true);
      await service.create(tenantId, dto, auth);
      expect(register.resolveSchema).toHaveBeenCalledWith({}, 'schema-1');
      expect(register.resolveIssuer).toHaveBeenCalledWith(
        {},
        { method: 'indy' },
      );
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          registration: expect.objectContaining({
            schema: { id: 'schema-1', state: 'finished' },
          }),
          options: { tag: 'default', revocation: { enabled: false } },
          metadata: {
            revocation: { enabled: false },
            issuer: 'DMV',
          },
        }),
        manager,
      );
    });

    it('rejects ambiguous schema and issuer selection before writing', async () => {
      await expect(
        service.create(
          auth.tenantId,
          {
            name: 'test',
            format: CredentialDefinitionFormat.ANONCREDS,
            schema: { id: 'schema-1', definition: {} },
          },
          auth,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create(
          auth.tenantId,
          {
            name: 'test',
            format: CredentialDefinitionFormat.ANONCREDS,
            schema: { id: 'schema-1' },
            issuer: {},
          },
          auth,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('rejects requests without a schema before resolving an adapter', async () => {
      const resolveAdapterCallCount = resolveAdapter.mock.calls.length;
      await expect(
        service.create(
          auth.tenantId,
          {
            name: 'Employee',
            format: CredentialDefinitionFormat.ANONCREDS,
            schema: {},
          },
          auth,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(resolveAdapter).toHaveBeenCalledTimes(resolveAdapterCallCount);
    });

    it('rejects connectors without registration support', async () => {
      resolveAdapter.mockResolvedValueOnce({
        connector: { id: 'connector-1', connectorType: 'traction' },
        context: {},
        adapter: {},
      });

      await expect(
        service.create(
          auth.tenantId,
          {
            name: 'Employee',
            format: CredentialDefinitionFormat.ANONCREDS,
            schema: { definition: mockCredentialDefinition.schemaDefinition },
          },
          auth,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it.each([
      { status: 503, expected: 'Traction registration service is unavailable' },
      { status: 429, expected: 'Traction registration service is unavailable' },
      {
        status: 400,
        expected: 'Traction could not resolve the requested issuer or schema',
      },
    ])(
      'translates adapter resolution HTTP status $status safely',
      async ({ status, expected }) => {
        const config = {
          headers: new AxiosHeaders({ Authorization: 'Bearer test-token' }),
        };
        resolveAdapter.mockRejectedValueOnce(
          new AxiosError(
            'unsafe backend message',
            'ERR_BAD_REQUEST',
            config,
            undefined,
            {
              status,
              statusText: 'Backend response',
              headers: {},
              config,
              data: {},
            },
          ),
        );

        await expect(
          service.create(
            auth.tenantId,
            {
              name: 'Employee',
              format: CredentialDefinitionFormat.ANONCREDS,
              schema: {
                definition: mockCredentialDefinition.schemaDefinition,
              },
            },
            auth,
          ),
        ).rejects.toMatchObject({ message: expected });
      },
    );

    it('translates failures while resolving an imported schema', async () => {
      register.resolveSchema.mockRejectedValueOnce(
        new RegistrationBackendError(503, 'UPSTREAM', 'Transient failure'),
      );

      await expect(
        service.create(
          auth.tenantId,
          {
            name: 'Employee',
            format: CredentialDefinitionFormat.ANONCREDS,
            schema: { id: 'schema-1' },
          },
          auth,
        ),
      ).rejects.toMatchObject({
        message: 'Traction registration service is unavailable',
      });
    });

    it('translates adapter errors while preserving their stable code and context', async () => {
      resolveAdapter.mockRejectedValueOnce(
        new FormatNotSupportedError('anoncreds', { connector: 'traction' }),
      );

      await expect(
        service.create(
          auth.tenantId,
          {
            name: 'Employee',
            format: CredentialDefinitionFormat.ANONCREDS,
            schema: { definition: mockCredentialDefinition.schemaDefinition },
          },
          auth,
        ),
      ).rejects.toMatchObject({
        response: {
          code: 'FORMAT_NOT_SUPPORTED',
          connector: 'traction',
        },
      });
    });

    it('maps retryable registration backend errors to service unavailable', async () => {
      register.resolveIssuer.mockRejectedValueOnce(
        new RegistrationBackendError(503, 'UPSTREAM', 'Transient failure'),
      );

      await expect(
        service.create(
          auth.tenantId,
          {
            name: 'Employee',
            format: CredentialDefinitionFormat.ANONCREDS,
            schema: { definition: mockCredentialDefinition.schemaDefinition },
          },
          auth,
        ),
      ).rejects.toMatchObject({
        message: 'Traction registration service is unavailable',
      });
    });

    it('rethrows unexpected registration adapter failures', async () => {
      const failure = new Error('unexpected adapter failure');
      resolveAdapter.mockRejectedValueOnce(failure);

      await expect(
        service.create(
          auth.tenantId,
          {
            name: 'Employee',
            format: CredentialDefinitionFormat.ANONCREDS,
            schema: { definition: mockCredentialDefinition.schemaDefinition },
          },
          auth,
        ),
      ).rejects.toBe(failure);
    });

    it('rejects an adapter that has an unknown connector type', async () => {
      resolveAdapter.mockResolvedValueOnce({
        connector: { id: 'connector-1', connectorType: 'unknown' },
        context: {},
        adapter: { definitionRegistration: register },
      });

      await expect(
        service.create(
          auth.tenantId,
          {
            name: 'Employee',
            format: CredentialDefinitionFormat.ANONCREDS,
            schema: { definition: mockCredentialDefinition.schemaDefinition },
          },
          auth,
        ),
      ).rejects.toThrow('Unknown registration connector type');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('maps a unique-index race during definition creation to conflict', async () => {
      const driverError = Object.assign(new Error('duplicate'), {
        code: '23505',
      });
      mockCreate.mockRejectedValueOnce(
        new QueryFailedError('INSERT', [], driverError),
      );

      await expect(
        service.create(
          auth.tenantId,
          {
            name: 'Employee',
            format: CredentialDefinitionFormat.ANONCREDS,
            schema: { definition: mockCredentialDefinition.schemaDefinition },
          },
          auth,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('maps unique-constraint races to a conflict', async () => {
      const driverError = Object.assign(new Error('duplicate'), {
        code: '23505',
      });
      mockCreate.mockRejectedValueOnce(
        new QueryFailedError('INSERT', [], driverError),
      );

      await expect(
        service.create(
          auth.tenantId,
          {
            name: 'Employee',
            format: CredentialDefinitionFormat.ANONCREDS,
            schema: { definition: mockCredentialDefinition.schemaDefinition },
          },
          auth,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('toPortCredentialFormat', () => {
    it('maps a shared format to the port-layer enum value', () => {
      expect(toPortCredentialFormat(CredentialDefinitionFormat.ANONCREDS)).toBe(
        CredentialFormat.AnonCreds,
      );
    });

    it('maps the mDL format to the port-layer enum value', () => {
      expect(toPortCredentialFormat(CredentialDefinitionFormat.MDL)).toBe(
        CredentialFormat.Mdl,
      );
    });

    it('does not map entity formats that have no matching port-layer value', () => {
      expect(
        toPortCredentialFormat(CredentialDefinitionFormat.SD_JWT),
      ).toBeUndefined();
      expect(
        toPortCredentialFormat(CredentialDefinitionFormat.W3C_VC),
      ).toBeUndefined();
    });
  });

  describe('findById', () => {
    it('should return a credential definition if found', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      const id = mockCredentialDefinition.id;
      mockFindById.mockResolvedValue(mockCredentialDefinition);

      const result = await service.findById(tenantId, id, auth);

      expect(mockFindById).toHaveBeenCalledWith(id);
      expect(result).toEqual(mockCredentialDefinition);
    });

    it('should throw NotFoundException if credential definition not found', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      const id = '999e4567-e89b-12d3-a456-426614174000';
      mockFindById.mockResolvedValue(null);

      await expect(service.findById(tenantId, id, auth)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockFindById).toHaveBeenCalledWith(id);
    });

    it('should throw NotFoundException if the definition belongs to a different tenant', async () => {
      const id = mockCredentialDefinition.id;
      mockFindById.mockResolvedValue(mockCredentialDefinition);

      await expect(
        service.findById('other-tenant-id', id, auth),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByTenantId', () => {
    it('should return all credential definitions for a tenant', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      const definitions = [mockCredentialDefinition];
      mockFindByTenantId.mockResolvedValue(definitions);

      const result = await service.findByTenantId(tenantId);

      expect(mockFindByTenantId).toHaveBeenCalledWith(tenantId);
      expect(result).toEqual(definitions);
    });

    it('should return empty array if no definitions found for tenant', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      mockFindByTenantId.mockResolvedValue([]);

      const result = await service.findByTenantId(tenantId);

      expect(result).toEqual([]);
    });
  });

  describe('findByFormat', () => {
    it('should return all credential definitions with specified format', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      const format = CredentialDefinitionFormat.ANONCREDS;
      const definitions = [mockCredentialDefinition];
      mockFindByFormat.mockResolvedValue(definitions);

      const result = await service.findByFormat(tenantId, format);

      expect(mockFindByFormat).toHaveBeenCalledWith(format, tenantId);
      expect(result).toEqual(definitions);
    });

    it('should return empty array if no definitions found for format', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      const format = CredentialDefinitionFormat.SD_JWT;
      mockFindByFormat.mockResolvedValue([]);

      const result = await service.findByFormat(tenantId, format);

      expect(result).toEqual([]);
    });
  });

  describe('findByConnector', () => {
    it('should return all credential definitions for connector type', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      const connectorType = CredentialDefinitionConnectorType.TRACTION;
      const definitions = [mockCredentialDefinition];
      mockFindByConnector.mockResolvedValue(definitions);

      const result = await service.findByConnector(tenantId, connectorType);

      expect(mockFindByConnector).toHaveBeenCalledWith(connectorType, tenantId);
      expect(result).toEqual(definitions);
    });

    it('should return empty array if no definitions found for connector', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      const connectorType = CredentialDefinitionConnectorType.CREDO;
      mockFindByConnector.mockResolvedValue([]);

      const result = await service.findByConnector(tenantId, connectorType);

      expect(result).toEqual([]);
    });
  });

  describe('update', () => {
    it('should update a credential definition if found', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      const id = mockCredentialDefinition.id;
      const dto = { name: 'Updated Name' };
      const updatedDefinition = { ...mockCredentialDefinition, ...dto };

      mockFindById.mockResolvedValue(mockCredentialDefinition);
      mockUpdate.mockResolvedValue(updatedDefinition);

      const result = await service.update(tenantId, id, dto, auth);

      expect(mockFindById).toHaveBeenCalledWith(id);
      expect(mockUpdate).toHaveBeenCalledWith(tenantId, id, {
        name: 'Updated Name',
      });
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: updatedDefinition.tenantId,
        action: AuditAction.UPDATE,
        resourceType: 'credential_definition',
        resourceId: updatedDefinition.id,
      });
      expect(result).toEqual(updatedDefinition);
    });

    it('should update metadata when provided', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      const id = mockCredentialDefinition.id;
      const dto = { metadata: { issuer: 'DMV', version: '2.0' } };
      const updatedDefinition = {
        ...mockCredentialDefinition,
        metadata: dto.metadata,
      };

      mockFindById.mockResolvedValue({
        ...mockCredentialDefinition,
        registration: {
          issuerId: 'issuer',
        },
      });
      mockUpdate.mockResolvedValue(updatedDefinition);

      const result = await service.update(tenantId, id, dto, auth);

      expect(mockUpdate).toHaveBeenCalledWith(tenantId, id, {
        metadata: dto.metadata,
      });
      expect(result.metadata).toEqual(dto.metadata);
    });

    it('preserves arbitrary metadata without publication defaults', async () => {
      mockFindById.mockResolvedValue(mockCredentialDefinition);
      mockUpdate.mockResolvedValue(mockCredentialDefinition);

      const metadata = { revocation: { enabled: 'true' }, tag: [] };
      await service.update(
        auth.tenantId,
        mockCredentialDefinition.id,
        { metadata },
        auth,
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        auth.tenantId,
        mockCredentialDefinition.id,
        { metadata },
      );
    });

    it('should throw NotFoundException if credential definition not found', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      const id = '999e4567-e89b-12d3-a456-426614174000';
      const dto = { name: 'Updated Name' };

      mockFindById.mockResolvedValue(null);

      await expect(service.update(tenantId, id, dto, auth)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockFindById).toHaveBeenCalledWith(id);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if the editable row disappears before update', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      const id = mockCredentialDefinition.id;

      mockFindById.mockResolvedValue(mockCredentialDefinition);
      mockUpdate.mockResolvedValue(null);

      await expect(
        service.update(tenantId, id, { name: 'Updated Name' }, auth),
      ).rejects.toThrow(NotFoundException);
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should deactivate a credential definition if found', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      const id = mockCredentialDefinition.id;
      mockFindById.mockResolvedValue(mockCredentialDefinition);

      await service.delete(tenantId, id, auth);

      expect(mockFindById).toHaveBeenCalledWith(id);
      expect(mockDeactivate).toHaveBeenCalledWith(id);
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: mockCredentialDefinition.tenantId,
        action: AuditAction.UPDATE,
        resourceType: 'credential_definition',
        resourceId: id,
      });
    });

    it('should throw NotFoundException if credential definition not found', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      const id = '999e4567-e89b-12d3-a456-426614174000';
      mockFindById.mockResolvedValue(null);

      await expect(service.delete(tenantId, id, auth)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockDeactivate).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException on a repeat delete, since the repository excludes already-inactive definitions', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      const id = mockCredentialDefinition.id;
      // The repository's findById only resolves active rows, so a
      // definition deactivated by a prior delete call surfaces as null here.
      mockFindById.mockResolvedValue(null);

      await expect(service.delete(tenantId, id, auth)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockDeactivate).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });
});
