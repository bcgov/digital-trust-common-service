/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';

import { ConnectorType } from '../connection/connection.entity';

import { ConnectorCredentialController } from './connector-credential.controller';
import { ConnectorCredential } from './connector-credential.entity';
import { ConnectorCredentialService } from './connector-credential.service';
import { ConnectorCredentialResponseDto } from './dto/connector-credential-response.dto';
import { CreateConnectorCredentialDto } from './dto/create-connector-credential.dto';

describe('ConnectorCredentialController', () => {
  let controller: ConnectorCredentialController;

  let mockCreate: jest.Mock;
  let mockFindById: jest.Mock;
  let mockFindByTenant: jest.Mock;
  let mockFindByTenantAndConnectorType: jest.Mock;
  let mockFindByTenantAndConnectorTypeAndActive: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockDelete: jest.Mock;
  let mockDecryptCredential: jest.Mock;

  const mockCredential: ConnectorCredential = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    tenantId: '123e4567-e89b-12d3-a456-426614174001',
    connectorType: ConnectorType.TRACTION,
    credentialsEncrypted: Buffer.from('encrypted_data'),
    endpointUrl: 'https://api.salesforce.com/v57.0',
    active: true,
    keyVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    tenant: undefined as any,
  };

  const mockResponseDto: ConnectorCredentialResponseDto = {
    id: mockCredential.id,
    tenantId: mockCredential.tenantId,
    connectorType: mockCredential.connectorType,
    endpointUrl: mockCredential.endpointUrl,
    active: mockCredential.active,
    keyVersion: mockCredential.keyVersion,
    createdAt: mockCredential.createdAt,
    updatedAt: mockCredential.updatedAt,
  };

  beforeEach(async () => {
    mockCreate = jest.fn();
    mockFindById = jest.fn();
    mockFindByTenant = jest.fn();
    mockFindByTenantAndConnectorType = jest.fn();
    mockFindByTenantAndConnectorTypeAndActive = jest.fn();
    mockUpdate = jest.fn();
    mockDelete = jest.fn();
    mockDecryptCredential = jest.fn();

    const mockService = {
      create: mockCreate,
      findById: mockFindById,
      findByTenant: mockFindByTenant,
      findByTenantAndConnectorType: mockFindByTenantAndConnectorType,
      findByTenantAndConnectorTypeAndActive:
        mockFindByTenantAndConnectorTypeAndActive,
      update: mockUpdate,
      delete: mockDelete,
      decryptCredential: mockDecryptCredential,
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConnectorCredentialController],
      providers: [
        {
          provide: ConnectorCredentialService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<ConnectorCredentialController>(
      ConnectorCredentialController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /connector-credentials', () => {
    it('should create a new connector credential', async () => {
      const dto: CreateConnectorCredentialDto = {
        tenantId: mockCredential.tenantId,
        connectorType: mockCredential.connectorType,
        credentialsPlainText: Buffer.from('encrypted_data').toString('base64'),
        endpointUrl: mockCredential.endpointUrl,
        active: mockCredential.active,
      };

      mockCreate.mockResolvedValue(mockCredential);

      const result = await controller.create(dto);

      expect(mockCreate).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockResponseDto);
    });
  });

  describe('GET /connector-credentials/:id', () => {
    it('should find a credential by ID', async () => {
      mockFindById.mockResolvedValue(mockCredential);

      const result = await controller.findById(mockCredential.id);

      expect(mockFindById).toHaveBeenCalledWith(mockCredential.id);
      expect(result).toEqual(mockResponseDto);
    });
  });

  describe('GET /connector-credentials/tenant/:tenantId', () => {
    it('should find all credentials for a tenant', async () => {
      mockFindByTenant.mockResolvedValue([mockCredential]);

      const result = await controller.findByTenant(mockCredential.tenantId);

      expect(mockFindByTenant).toHaveBeenCalledWith(mockCredential.tenantId);
      expect(result).toEqual([mockResponseDto]);
    });

    it('should filter by connector type when provided', async () => {
      mockFindByTenantAndConnectorType.mockResolvedValue([mockCredential]);

      const result = await controller.findByTenant(
        mockCredential.tenantId,
        mockCredential.connectorType,
      );

      expect(mockFindByTenantAndConnectorType).toHaveBeenCalledWith(
        mockCredential.tenantId,
        mockCredential.connectorType,
      );
      expect(result).toEqual([mockResponseDto]);
    });

    it('should filter by connector type and active status when both provided', async () => {
      mockFindByTenantAndConnectorTypeAndActive.mockResolvedValue([
        mockCredential,
      ]);

      const result = await controller.findByTenant(
        mockCredential.tenantId,
        mockCredential.connectorType,
        'true',
      );

      expect(mockFindByTenantAndConnectorTypeAndActive).toHaveBeenCalledWith(
        mockCredential.tenantId,
        mockCredential.connectorType,
        true,
      );
      expect(result).toEqual([mockResponseDto]);
    });
  });

  describe('PATCH /connector-credentials/:id', () => {
    it('should update a connector credential', async () => {
      const updateDto = { active: false };
      const updatedCredential = { ...mockCredential, active: false };
      const updatedResponseDto = { ...mockResponseDto, active: false };

      mockUpdate.mockResolvedValue(updatedCredential);

      const result = await controller.update(mockCredential.id, updateDto);

      expect(mockUpdate).toHaveBeenCalledWith(mockCredential.id, updateDto);
      expect(result).toEqual(updatedResponseDto);
    });
  });

  describe('DELETE /connector-credentials/:id', () => {
    it('should delete a connector credential', async () => {
      mockDelete.mockResolvedValue(undefined);

      await controller.delete(mockCredential.id);

      expect(mockDelete).toHaveBeenCalledWith(mockCredential.id);
    });
  });

  describe('GET /connector-credentials/:id/decrypt', () => {
    const validHexKey =
      '2222222222222222222222222222222222222222222222222222222222222222';

    it('should decrypt a connector credential with valid key', async () => {
      const decryptedValue = 'decrypted_credentials_content';

      mockDecryptCredential.mockResolvedValue(decryptedValue);

      const result = await controller.decrypt(mockCredential.id, validHexKey);

      expect(mockDecryptCredential).toHaveBeenCalledWith(
        validHexKey,
        mockCredential.id,
      );
      expect(result).toEqual(decryptedValue);
    });

    it('should throw BadRequestException for invalid key length', async () => {
      const invalidKey = 'tooshort';

      mockDecryptCredential.mockRejectedValue(
        new Error(
          `Invalid key format. Expected 64 hex characters (32 bytes) but got ${invalidKey.length} characters.`,
        ),
      );

      await expect(
        controller.decrypt(mockCredential.id, invalidKey),
      ).rejects.toThrow();
    });

    it('should throw BadRequestException for invalid hex key', async () => {
      const invalidHexKey =
        'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ';

      mockDecryptCredential.mockRejectedValue(
        new Error(`Key must be a valid hexadecimal string.`),
      );

      await expect(
        controller.decrypt(mockCredential.id, invalidHexKey),
      ).rejects.toThrow();
    });

    it('should throw NotFoundException when credential not found', async () => {
      mockDecryptCredential.mockRejectedValue(
        new Error(
          `Connector credential with ID '${mockCredential.id}' was not found.`,
        ),
      );

      await expect(
        controller.decrypt(mockCredential.id, validHexKey),
      ).rejects.toThrow();
    });

    it('should throw BadRequestException on decryption failure', async () => {
      mockDecryptCredential.mockRejectedValue(
        new Error(
          `Failed to decrypt connector credential with ID '${mockCredential.id}': Authentication tag mismatch`,
        ),
      );

      await expect(
        controller.decrypt(mockCredential.id, validHexKey),
      ).rejects.toThrow();
    });

    it('should throw BadRequestException when key is an array (type confusion vulnerability)', async () => {
      const keyArray = [validHexKey, 'another_key'] as any;

      await expect(
        controller.decrypt(mockCredential.id, keyArray),
      ).rejects.toThrow(
        'Parameter "key" must be a single string value, not an array.',
      );

      expect(mockDecryptCredential).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when key is not a string type', async () => {
      const invalidKeyType = 12345 as any;

      await expect(
        controller.decrypt(mockCredential.id, invalidKeyType),
      ).rejects.toThrow('Parameter "key" must be a string value.');

      expect(mockDecryptCredential).not.toHaveBeenCalled();
    });
  });
});
