import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

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
  let mockDelete: jest.Mock;

  const mockCredentialDefinition: CredentialDefinition = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    tenantId: '123e4567-e89b-12d3-a456-426614174001',
    name: 'Test Credential',
    format: CredentialDefinitionFormat.ANONCREDS,
    schemaDefinition: { schema: 'test' },
    externalId: 'external-123',
    connectorType: CredentialDefinitionConnectorType.TRACTION,
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

  beforeEach(async () => {
    mockCreate = jest.fn();
    mockFindById = jest.fn();
    mockFindByTenantId = jest.fn();
    mockFindByTenantAndNameAndFormat = jest.fn();
    mockFindByFormat = jest.fn();
    mockFindByConnector = jest.fn();
    mockUpdate = jest.fn();
    mockDelete = jest.fn();

    const mockRepository = {
      create: mockCreate,
      findById: mockFindById,
      findByTenantId: mockFindByTenantId,
      findByTenantAndNameAndFormat: mockFindByTenantAndNameAndFormat,
      findByFormat: mockFindByFormat,
      findByConnector: mockFindByConnector,
      update: mockUpdate,
      delete: mockDelete,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CredentialDefinitionService,
        {
          provide: CredentialDefinitionRepository,
          useValue: mockRepository,
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

      const result = await service.create(dto);

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

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      expect(mockFindByTenantAndNameAndFormat).toHaveBeenCalledWith(
        dto.tenantId,
        dto.name,
        dto.format,
      );
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should return a credential definition if found', async () => {
      const id = mockCredentialDefinition.id;
      mockFindById.mockResolvedValue(mockCredentialDefinition);

      const result = await service.findById(id);

      expect(mockFindById).toHaveBeenCalledWith(id);
      expect(result).toEqual(mockCredentialDefinition);
    });

    it('should throw NotFoundException if credential definition not found', async () => {
      const id = '999e4567-e89b-12d3-a456-426614174000';
      mockFindById.mockResolvedValue(null);

      await expect(service.findById(id)).rejects.toThrow(NotFoundException);
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

      const result = await service.findByFormat(format);

      expect(mockFindByFormat).toHaveBeenCalledWith(format);
      expect(result).toEqual(definitions);
    });

    it('should return empty array if no definitions found for format', async () => {
      const format = CredentialDefinitionFormat.SD_JWT;
      mockFindByFormat.mockResolvedValue([]);

      const result = await service.findByFormat(format);

      expect(result).toEqual([]);
    });
  });

  describe('findByConnector', () => {
    it('should return all credential definitions for connector type', async () => {
      const connectorType = CredentialDefinitionConnectorType.TRACTION;
      const definitions = [mockCredentialDefinition];
      mockFindByConnector.mockResolvedValue(definitions);

      const result = await service.findByConnector(connectorType);

      expect(mockFindByConnector).toHaveBeenCalledWith(connectorType);
      expect(result).toEqual(definitions);
    });

    it('should return empty array if no definitions found for connector', async () => {
      const connectorType = CredentialDefinitionConnectorType.CREDO;
      mockFindByConnector.mockResolvedValue([]);

      const result = await service.findByConnector(connectorType);

      expect(result).toEqual([]);
    });
  });

  describe('update', () => {
    it('should update a credential definition if found', async () => {
      const id = mockCredentialDefinition.id;
      const dto = { name: 'Updated Name' };
      const updatedDefinition = { ...mockCredentialDefinition, ...dto };

      mockFindById.mockResolvedValue(mockCredentialDefinition);
      mockUpdate.mockResolvedValue(updatedDefinition);

      const result = await service.update(id, dto);

      expect(mockFindById).toHaveBeenCalledWith(id);
      expect(mockUpdate).toHaveBeenCalled();
      expect(result).toEqual(updatedDefinition);
    });

    it('should throw NotFoundException if credential definition not found', async () => {
      const id = '999e4567-e89b-12d3-a456-426614174000';
      const dto = { name: 'Updated Name' };

      mockFindById.mockResolvedValue(null);

      await expect(service.update(id, dto)).rejects.toThrow(NotFoundException);
      expect(mockFindById).toHaveBeenCalledWith(id);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete a credential definition if found', async () => {
      const id = mockCredentialDefinition.id;
      mockFindById.mockResolvedValue(mockCredentialDefinition);

      await service.delete(id);

      expect(mockFindById).toHaveBeenCalledWith(id);
      expect(mockDelete).toHaveBeenCalledWith(id);
    });

    it('should throw NotFoundException if credential definition not found', async () => {
      const id = '999e4567-e89b-12d3-a456-426614174000';
      mockFindById.mockResolvedValue(null);

      await expect(service.delete(id)).rejects.toThrow(NotFoundException);
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });
});
