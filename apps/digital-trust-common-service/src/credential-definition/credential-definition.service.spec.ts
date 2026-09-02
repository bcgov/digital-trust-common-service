import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { TenantStatus } from '../tenant/tenant.entity';

import {
  CredentialDefinition,
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
} from './credential-definition.entity';
import { CredentialDefinitionRepository } from './credential-definition.repository';
import { CredentialDefinitionService } from './credential-definition.service';
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

    const mockRepository = {
      create: mockCreate,
      findById: mockFindById,
      findByTenantId: mockFindByTenantId,
      findByTenantAndNameAndFormat: mockFindByTenantAndNameAndFormat,
      findByFormat: mockFindByFormat,
      findByConnector: mockFindByConnector,
      update: mockUpdate,
      deactivate: mockDeactivate,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialDefinitionService,
        {
          provide: CredentialDefinitionRepository,
          useValue: mockRepository,
        },
        {
          provide: DomainAuditService,
          useValue: { emit: mockEmit },
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
    it('should create a new credential definition if name is unique for tenant', async () => {
      const dto: CreateCredentialDefinitionDto = {
        tenantId: mockCredentialDefinition.tenantId,
        name: mockCredentialDefinition.name,
        format: mockCredentialDefinition.format,
        schemaDefinition: mockCredentialDefinition.schemaDefinition,
        externalId: mockCredentialDefinition.externalId,
        connectorType: mockCredentialDefinition.connectorType,
        metadata: mockCredentialDefinition.metadata,
      };

      mockFindByTenantAndNameAndFormat.mockResolvedValue(null);
      mockCreate.mockResolvedValue(mockCredentialDefinition);

      const result = await service.create(dto, auth);

      expect(mockFindByTenantAndNameAndFormat).toHaveBeenCalledWith(
        dto.tenantId,
        dto.name,
        dto.format,
      );
      expect(mockCreate).toHaveBeenCalledWith({
        tenantId: dto.tenantId,
        name: dto.name,
        format: dto.format,
        schemaDefinition: dto.schemaDefinition,
        externalId: dto.externalId,
        connectorType: dto.connectorType,
        metadata: dto.metadata,
      });
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: mockCredentialDefinition.tenantId,
        action: AuditAction.CREATE,
        resourceType: 'credential_definition',
        resourceId: mockCredentialDefinition.id,
      });
      expect(result).toEqual(mockCredentialDefinition);
    });

    it('should throw ConflictException if name already exists for tenant', async () => {
      const dto: CreateCredentialDefinitionDto = {
        tenantId: mockCredentialDefinition.tenantId,
        name: mockCredentialDefinition.name,
        format: mockCredentialDefinition.format,
        schemaDefinition: mockCredentialDefinition.schemaDefinition,
        externalId: mockCredentialDefinition.externalId,
        connectorType: mockCredentialDefinition.connectorType,
        metadata: mockCredentialDefinition.metadata,
      };

      mockFindByTenantAndNameAndFormat.mockResolvedValue(
        mockCredentialDefinition,
      );

      await expect(service.create(dto, auth)).rejects.toThrow(
        ConflictException,
      );
      expect(mockFindByTenantAndNameAndFormat).toHaveBeenCalledWith(
        dto.tenantId,
        dto.name,
        dto.format,
      );
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should return a credential definition if found', async () => {
      const id = mockCredentialDefinition.id;
      mockFindById.mockResolvedValue(mockCredentialDefinition);

      const result = await service.findById(id, auth);

      expect(mockFindById).toHaveBeenCalledWith(id);
      expect(result).toEqual(mockCredentialDefinition);
    });

    it('should throw NotFoundException if credential definition not found', async () => {
      const id = '999e4567-e89b-12d3-a456-426614174000';
      mockFindById.mockResolvedValue(null);

      await expect(service.findById(id, auth)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockFindById).toHaveBeenCalledWith(id);
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
      const format = CredentialDefinitionFormat.ANONCREDS;
      const definitions = [mockCredentialDefinition];
      mockFindByFormat.mockResolvedValue(definitions);

      const result = await service.findByFormat(format, auth);

      expect(mockFindByFormat).toHaveBeenCalledWith(format, auth.tenantId);
      expect(result).toEqual(definitions);
    });

    it('should return empty array if no definitions found for format', async () => {
      const format = CredentialDefinitionFormat.SD_JWT;
      mockFindByFormat.mockResolvedValue([]);

      const result = await service.findByFormat(format, auth);

      expect(result).toEqual([]);
    });

    it('lists all tenants for platform-admin without a tenant filter', async () => {
      const format = CredentialDefinitionFormat.ANONCREDS;
      const definitions = [mockCredentialDefinition];
      mockFindByFormat.mockResolvedValue(definitions);

      const result = await service.findByFormat(format, {
        ...auth,
        roles: ['platform-admin'],
      });

      expect(mockFindByFormat).toHaveBeenCalledWith(format);
      expect(result).toEqual(definitions);
    });

    it('returns an empty list when the token has no tenant_id', async () => {
      await expect(
        service.findByFormat(CredentialDefinitionFormat.ANONCREDS, {
          ...auth,
          tenantId: null,
        }),
      ).resolves.toEqual([]);
      expect(mockFindByFormat).not.toHaveBeenCalled();
    });
  });

  describe('findByConnector', () => {
    it('should return all credential definitions for connector type', async () => {
      const connectorType = CredentialDefinitionConnectorType.TRACTION;
      const definitions = [mockCredentialDefinition];
      mockFindByConnector.mockResolvedValue(definitions);

      const result = await service.findByConnector(connectorType, auth);

      expect(mockFindByConnector).toHaveBeenCalledWith(
        connectorType,
        auth.tenantId,
      );
      expect(result).toEqual(definitions);
    });

    it('should return empty array if no definitions found for connector', async () => {
      const connectorType = CredentialDefinitionConnectorType.CREDO;
      mockFindByConnector.mockResolvedValue([]);

      const result = await service.findByConnector(connectorType, auth);

      expect(result).toEqual([]);
    });

    it('lists all tenants for platform-admin without a tenant filter', async () => {
      const connectorType = CredentialDefinitionConnectorType.TRACTION;
      mockFindByConnector.mockResolvedValue([mockCredentialDefinition]);

      const result = await service.findByConnector(connectorType, {
        ...auth,
        roles: ['platform-admin'],
      });

      expect(mockFindByConnector).toHaveBeenCalledWith(connectorType);
      expect(result).toEqual([mockCredentialDefinition]);
    });

    it('returns an empty list when the token has no tenant_id', async () => {
      await expect(
        service.findByConnector(CredentialDefinitionConnectorType.TRACTION, {
          ...auth,
          tenantId: null,
        }),
      ).resolves.toEqual([]);
      expect(mockFindByConnector).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update a credential definition if found', async () => {
      const id = mockCredentialDefinition.id;
      const dto = { name: 'Updated Name' };
      const updatedDefinition = { ...mockCredentialDefinition, ...dto };

      mockFindById.mockResolvedValue(mockCredentialDefinition);
      mockUpdate.mockResolvedValue(updatedDefinition);

      const result = await service.update(id, dto, auth);

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
      const id = mockCredentialDefinition.id;
      const dto = { metadata: { issuer: 'DMV', version: '2.0' } };
      const updatedDefinition = { ...mockCredentialDefinition, ...dto };

      mockFindById.mockResolvedValue({ ...mockCredentialDefinition });
      mockUpdate.mockResolvedValue(updatedDefinition);

      const result = await service.update(id, dto, auth);

      expect(result.metadata).toEqual(dto.metadata);
    });

    it('should throw NotFoundException if credential definition not found', async () => {
      const id = '999e4567-e89b-12d3-a456-426614174000';
      const dto = { name: 'Updated Name' };

      mockFindById.mockResolvedValue(null);

      await expect(service.update(id, dto, auth)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockFindById).toHaveBeenCalledWith(id);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should deactivate a credential definition if found', async () => {
      const id = mockCredentialDefinition.id;
      mockFindById.mockResolvedValue(mockCredentialDefinition);

      await service.delete(id, auth);

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
      const id = '999e4567-e89b-12d3-a456-426614174000';
      mockFindById.mockResolvedValue(null);

      await expect(service.delete(id, auth)).rejects.toThrow(NotFoundException);
      expect(mockDeactivate).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });
});
