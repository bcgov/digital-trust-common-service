import { Test, TestingModule } from '@nestjs/testing';

import { TenantStatus } from '../tenant/tenant.entity';

import { CredentialDefinitionController } from './credential-definition.controller';
import {
  CredentialDefinition,
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
} from './credential-definition.entity';
import { CredentialDefinitionService } from './credential-definition.service';
import { CreateCredentialDefinitionDto } from './dto/create-credential-definition.dto';

describe('CredentialDefinitionController', () => {
  let controller: CredentialDefinitionController;

  let mockCreate: jest.Mock;
  let mockFindById: jest.Mock;
  let mockFindByTenantId: jest.Mock;
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
      users: [],
    },
  };

  beforeEach(async () => {
    mockCreate = jest.fn();
    mockFindById = jest.fn();
    mockFindByTenantId = jest.fn();
    mockFindByFormat = jest.fn();
    mockFindByConnector = jest.fn();
    mockUpdate = jest.fn();
    mockDelete = jest.fn();

    const mockService = {
      create: mockCreate,
      findById: mockFindById,
      findByTenantId: mockFindByTenantId,
      findByFormat: mockFindByFormat,
      findByConnector: mockFindByConnector,
      update: mockUpdate,
      delete: mockDelete,
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CredentialDefinitionController],
      providers: [
        {
          provide: CredentialDefinitionService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<CredentialDefinitionController>(
      CredentialDefinitionController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /credential-definitions', () => {
    it('should create a new credential definition', async () => {
      const dto: CreateCredentialDefinitionDto = {
        tenantId: mockCredentialDefinition.tenantId,
        name: mockCredentialDefinition.name,
        format: mockCredentialDefinition.format,
        schemaDefinition: mockCredentialDefinition.schemaDefinition,
        externalId: mockCredentialDefinition.externalId,
        connectorType: mockCredentialDefinition.connectorType,
        metadata: mockCredentialDefinition.metadata,
      };

      mockCreate.mockResolvedValue(mockCredentialDefinition);

      const result = await controller.create(dto);

      expect(mockCreate).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockCredentialDefinition);
    });
  });

  describe('GET /credential-definitions/:id', () => {
    it('should return a credential definition by id', async () => {
      const id = mockCredentialDefinition.id;
      mockFindById.mockResolvedValue(mockCredentialDefinition);

      const result = await controller.findById(id);

      expect(mockFindById).toHaveBeenCalledWith(id);
      expect(result).toEqual(mockCredentialDefinition);
    });

    it('should throw NotFoundException if credential definition not found', async () => {
      const id = '999e4567-e89b-12d3-a456-426614174000';
      mockFindById.mockRejectedValue(
        new Error('Credential definition not found'),
      );

      await expect(controller.findById(id)).rejects.toThrow();
      expect(mockFindById).toHaveBeenCalledWith(id);
    });
  });

  describe('GET /credential-definitions/tenant/:tenantId', () => {
    it('should return all credential definitions for a tenant', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      const definitions = [mockCredentialDefinition];
      mockFindByTenantId.mockResolvedValue(definitions);

      const result = await controller.findByTenantId(tenantId);

      expect(mockFindByTenantId).toHaveBeenCalledWith(tenantId);
      expect(result).toEqual(definitions);
    });

    it('should return empty array if no definitions found for tenant', async () => {
      const tenantId = mockCredentialDefinition.tenantId;
      mockFindByTenantId.mockResolvedValue([]);

      const result = await controller.findByTenantId(tenantId);

      expect(result).toEqual([]);
    });
  });

  describe('GET /credential-definitions/format/:format', () => {
    it('should return all credential definitions with specified format', async () => {
      const format = CredentialDefinitionFormat.ANONCREDS;
      const definitions = [mockCredentialDefinition];
      mockFindByFormat.mockResolvedValue(definitions);

      const result = await controller.findByFormat(format);

      expect(mockFindByFormat).toHaveBeenCalledWith(format);
      expect(result).toEqual(definitions);
    });

    it('should return empty array if no definitions found for format', async () => {
      const format = CredentialDefinitionFormat.SD_JWT;
      mockFindByFormat.mockResolvedValue([]);

      const result = await controller.findByFormat(format);

      expect(result).toEqual([]);
    });
  });

  describe('GET /credential-definitions/connector/:connectorType', () => {
    it('should return all credential definitions for connector type', async () => {
      const connectorType = CredentialDefinitionConnectorType.TRACTION;
      const definitions = [mockCredentialDefinition];
      mockFindByConnector.mockResolvedValue(definitions);

      const result = await controller.findByConnector(connectorType);

      expect(mockFindByConnector).toHaveBeenCalledWith(connectorType);
      expect(result).toEqual(definitions);
    });

    it('should return empty array if no definitions found for connector', async () => {
      const connectorType = CredentialDefinitionConnectorType.CREDO;
      mockFindByConnector.mockResolvedValue([]);

      const result = await controller.findByConnector(connectorType);

      expect(result).toEqual([]);
    });
  });

  describe('PATCH /credential-definitions/:id', () => {
    it('should update a credential definition', async () => {
      const id = mockCredentialDefinition.id;
      const dto = { name: 'Updated Name' };
      const updatedDefinition = { ...mockCredentialDefinition, ...dto };

      mockUpdate.mockResolvedValue(updatedDefinition);

      const result = await controller.update(id, dto);

      expect(mockUpdate).toHaveBeenCalledWith(id, dto);
      expect(result).toEqual(updatedDefinition);
    });

    it('should throw NotFoundException if credential definition not found', async () => {
      const id = '999e4567-e89b-12d3-a456-426614174000';
      const dto = { name: 'Updated Name' };

      mockUpdate.mockRejectedValue(
        new Error('Credential definition not found'),
      );

      await expect(controller.update(id, dto)).rejects.toThrow();
      expect(mockUpdate).toHaveBeenCalledWith(id, dto);
    });
  });

  describe('DELETE /credential-definitions/:id', () => {
    it('should delete a credential definition', async () => {
      const id = mockCredentialDefinition.id;
      mockDelete.mockResolvedValue(undefined);

      await controller.delete(id);

      expect(mockDelete).toHaveBeenCalledWith(id);
    });

    it('should throw NotFoundException if credential definition not found', async () => {
      const id = '999e4567-e89b-12d3-a456-426614174000';
      mockDelete.mockRejectedValue(
        new Error('Credential definition not found'),
      );

      await expect(controller.delete(id)).rejects.toThrow();
      expect(mockDelete).toHaveBeenCalledWith(id);
    });
  });
});
