import {
  CredentialFormat,
  FormatValidatorRegistry,
} from '@app/credential-ports';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { RegistrationBackendError } from '../common/registration-backend-error';
import { JobsService } from '../jobs/jobs.service';
import { OperationService } from '../operation/operation.service';
import { TenantStatus } from '../tenant/tenant.entity';

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
  let mockFindByTenantAndNameAndFormat: jest.Mock;
  let mockFindByFormat: jest.Mock;
  let mockFindByConnector: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockDeactivate: jest.Mock;
  let mockEmit: jest.Mock;
  let mockHas: jest.Mock;
  let mockResolve: jest.Mock;
  let mockValidateSchema: jest.Mock;
  const manager = { save: jest.fn(), query: jest.fn(), findOne: jest.fn() };
  const findByFingerprint = jest.fn();
  const register = {
    resolveIssuer: jest.fn(),
    resolveSchema: jest.fn(),
  };
  const resolveAdapter = jest.fn();
  const createOperation = jest.fn();
  const enqueue = jest.fn();

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
    mockCreate = jest.fn();
    mockFindById = jest.fn();
    mockFindByTenantId = jest.fn();
    mockFindByTenantAndNameAndFormat = jest.fn();
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
    mockCreate.mockResolvedValue(mockCredentialDefinition);
    mockFindByTenantAndNameAndFormat.mockResolvedValue(null);
    findByFingerprint.mockResolvedValue(null);
    manager.findOne.mockResolvedValue(null);
    enqueue.mockResolvedValue('job-1');

    const mockRepository = {
      create: mockCreate,
      findById: mockFindById,
      findByTenantId: mockFindByTenantId,
      findByTenantAndNameAndFormat: mockFindByTenantAndNameAndFormat,
      findByFingerprint,
      findByFormat: mockFindByFormat,
      findByConnector: mockFindByConnector,
      update: mockUpdate,
      deactivate: mockDeactivate,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialDefinitionService,
        { provide: AdapterRegistry, useValue: { resolve: resolveAdapter } },
        { provide: OperationService, useValue: { createOperation } },
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

    it.each(['pending', 'completed', 'failed'])(
      'returns the existing %s operation for an equivalent request without enqueue or audit',
      async (state) => {
        findByFingerprint.mockResolvedValueOnce({
          ...mockCredentialDefinition,
          registrationOperationId: 'original-operation',
        });
        manager.findOne.mockResolvedValue({ id: 'original-operation', state });
        const result = await service.create(
          mockCredentialDefinition.tenantId,
          {
            name: 'Employee',
            format: CredentialDefinitionFormat.ANONCREDS,
            schema: { definition: mockCredentialDefinition.schemaDefinition },
          },
          auth,
        );
        expect(result).toEqual({ id: 'original-operation', state });
        expect(manager.findOne).toHaveBeenCalledWith(expect.any(Function), {
          where: { tenantId: auth.tenantId, id: 'original-operation' },
        });
        expect(enqueue).not.toHaveBeenCalled();
        expect(mockCreate).not.toHaveBeenCalled();
        expect(mockEmit).not.toHaveBeenCalled();
      },
    );

    it('rejects a replay whose operation has expired without republishing', async () => {
      findByFingerprint.mockResolvedValueOnce({
        ...mockCredentialDefinition,
        registrationOperationId: 'expired',
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
      ).rejects.toThrow(ConflictException);
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('rejects different local requests for the same artifacts', async () => {
      findByFingerprint.mockResolvedValueOnce(null).mockResolvedValueOnce({
        ...mockCredentialDefinition,
        registrationOperationId: 'original-operation',
      });
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
      ).rejects.toThrow(ConflictException);
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('should create a new credential definition if name is unique for tenant', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      const dto: CreateCredentialDefinitionDto = {
        name: mockCredentialDefinition.name,
        format: mockCredentialDefinition.format,
        schema: { definition: mockCredentialDefinition.schemaDefinition },
        metadata: mockCredentialDefinition.metadata,
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
            schemaId: undefined,
            options: { tag: 'default', revocation: { enabled: true } },
          },
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

    it('rejects unsupported publishing formats', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      const dto: CreateCredentialDefinitionDto = {
        name: mockCredentialDefinition.name,
        format: CredentialDefinitionFormat.SD_JWT,
        schema: { definition: mockCredentialDefinition.schemaDefinition },
        metadata: mockCredentialDefinition.metadata,
      };

      mockFindByTenantAndNameAndFormat.mockResolvedValue(null);
      mockCreate.mockResolvedValue(mockCredentialDefinition);

      await expect(service.create(tenantId, dto, auth)).rejects.toThrow(
        BadRequestException,
      );

      // SD_JWT has no matching port-layer format value, so the format
      // never resolves and the registry is never consulted.
      expect(mockHas).not.toHaveBeenCalled();
      expect(mockResolve).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
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
            schemaId: 'schema-1',
            options: { tag: 'default', revocation: { enabled: false } },
          }),
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

    it('returns undefined for a format the port layer does not implement', () => {
      // W3C_VC's stored value ('w3c-vc') does not match the port layer's
      // JsonLd value ('jsonld'), so it stays unmapped until a follow-up
      // change reconciles the two enums.
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
      expect(mockUpdate).toHaveBeenCalled();
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
      const updatedDefinition = { ...mockCredentialDefinition, ...dto };

      mockFindById.mockResolvedValue({ ...mockCredentialDefinition });
      mockUpdate.mockResolvedValue(updatedDefinition);

      const result = await service.update(tenantId, id, dto, auth);

      expect(result.metadata).toEqual(dto.metadata);
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
