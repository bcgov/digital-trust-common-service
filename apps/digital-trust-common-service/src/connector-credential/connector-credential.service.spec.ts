import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { EncryptionService } from '../common/crypto/encryption.service';
import { ConnectorType } from '../connection/connection.entity';
import { TenantService } from '../tenant/tenant.service';

import { ConnectorCredential } from './connector-credential.entity';
import { ConnectorCredentialRepository } from './connector-credential.repository';
import { ConnectorCredentialService } from './connector-credential.service';
import { CreateConnectorCredentialDto } from './dto/create-connector-credential.dto';

describe('ConnectorCredentialService', () => {
  let service: ConnectorCredentialService;
  let mockFindById: jest.Mock;
  let mockFindByTenant: jest.Mock;
  let mockFindByTenantAndConnectorType: jest.Mock;
  let mockFindByTenantAndConnectorTypeAndActive: jest.Mock;
  let mockCreate: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockDelete: jest.Mock;
  let mockTenantServiceFindById: jest.Mock;
  let mockEncrypt: jest.Mock;
  let mockDecryptWithKey: jest.Mock;
  let mockRequiresRotation: jest.Mock;

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

  beforeEach(async () => {
    mockFindById = jest.fn();
    mockFindByTenant = jest.fn();
    mockFindByTenantAndConnectorType = jest.fn();
    mockFindByTenantAndConnectorTypeAndActive = jest.fn();
    mockCreate = jest.fn();
    mockUpdate = jest.fn();
    mockDelete = jest.fn();
    mockTenantServiceFindById = jest
      .fn()
      .mockResolvedValue({ id: mockCredential.tenantId });
    mockEncrypt = jest.fn().mockReturnValue({
      ciphertext: Buffer.from('encrypted_data'),
      keyVersion: 1,
    });
    mockDecryptWithKey = jest.fn();
    mockRequiresRotation = jest.fn().mockReturnValue(false);

    const mockRepository = {
      findById: mockFindById,
      findByTenant: mockFindByTenant,
      findByTenantAndConnectorType: mockFindByTenantAndConnectorType,
      findByTenantAndConnectorTypeAndActive:
        mockFindByTenantAndConnectorTypeAndActive,
      create: mockCreate,
      update: mockUpdate,
      delete: mockDelete,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectorCredentialService,
        {
          provide: ConnectorCredentialRepository,
          useValue: mockRepository,
        },
        {
          provide: TenantService,
          useValue: {
            findById: mockTenantServiceFindById,
          },
        },
        {
          provide: EncryptionService,
          useValue: {
            encrypt: mockEncrypt,
            decryptWithKey: mockDecryptWithKey,
            requiresRotation: mockRequiresRotation,
            decrypt: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ConnectorCredentialService>(
      ConnectorCredentialService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a new connector credential', async () => {
      const dto: CreateConnectorCredentialDto = {
        tenantId: mockCredential.tenantId,
        connectorType: mockCredential.connectorType,
        credentialsPlainText: Buffer.from('encrypted_data').toString('base64'),
        endpointUrl: mockCredential.endpointUrl,
        active: mockCredential.active,
      };

      mockCreate.mockResolvedValue(mockCredential);

      const result = await service.create(dto);

      expect(mockCreate).toHaveBeenCalled();
      expect(result).toEqual(mockCredential);
    });
  });

  describe('findById', () => {
    it('should find a credential by ID', async () => {
      mockFindById.mockResolvedValue(mockCredential);

      const result = await service.findById(mockCredential.id);

      expect(mockFindById).toHaveBeenCalledWith(mockCredential.id);
      expect(result).toEqual(mockCredential);
    });

    it('should throw NotFoundException if credential not found', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(service.findById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByTenant', () => {
    it('should find all credentials for a tenant', async () => {
      mockFindByTenant.mockResolvedValue([mockCredential]);

      const result = await service.findByTenant(mockCredential.tenantId);

      expect(mockFindByTenant).toHaveBeenCalledWith(mockCredential.tenantId);
      expect(result).toEqual([mockCredential]);
    });
  });

  describe('findByTenantAndConnectorType', () => {
    it('should find credentials by tenant and connector type', async () => {
      mockFindByTenantAndConnectorType.mockResolvedValue([mockCredential]);

      const result = await service.findByTenantAndConnectorType(
        mockCredential.tenantId,
        mockCredential.connectorType,
      );

      expect(mockFindByTenantAndConnectorType).toHaveBeenCalledWith(
        mockCredential.tenantId,
        mockCredential.connectorType,
      );
      expect(result).toEqual([mockCredential]);
    });
  });

  describe('findByTenantAndConnectorTypeAndActive', () => {
    it('should find active credentials by tenant and connector type', async () => {
      mockFindByTenantAndConnectorTypeAndActive.mockResolvedValue([
        mockCredential,
      ]);

      const result = await service.findByTenantAndConnectorTypeAndActive(
        mockCredential.tenantId,
        mockCredential.connectorType,
        true,
      );

      expect(mockFindByTenantAndConnectorTypeAndActive).toHaveBeenCalledWith(
        mockCredential.tenantId,
        mockCredential.connectorType,
        true,
      );
      expect(result).toEqual([mockCredential]);
    });
  });

  describe('update', () => {
    it('should update a connector credential', async () => {
      const updateDto = { active: false };
      const updatedCredential = { ...mockCredential, active: false };

      mockFindById.mockResolvedValue(mockCredential);
      mockUpdate.mockResolvedValue(updatedCredential);

      const result = await service.update(mockCredential.id, updateDto);

      expect(mockFindById).toHaveBeenCalledWith(mockCredential.id);
      expect(mockUpdate).toHaveBeenCalled();
      expect(result).toEqual(updatedCredential);
    });

    it('should throw NotFoundException if credential not found during update', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(
        service.update('nonexistent', { active: false }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('should delete a connector credential', async () => {
      mockFindById.mockResolvedValue(mockCredential);
      mockDelete.mockResolvedValue(undefined);

      await service.delete(mockCredential.id);

      expect(mockFindById).toHaveBeenCalledWith(mockCredential.id);
      expect(mockDelete).toHaveBeenCalledWith(mockCredential.id);
    });

    it('should throw NotFoundException if credential not found during delete', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(service.delete('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('decryptCredential', () => {
    const validHexKey =
      '2222222222222222222222222222222222222222222222222222222222222222';

    it('should decrypt a connector credential with valid key', async () => {
      const decryptedValue = 'decrypted_credentials_content';

      mockFindById.mockResolvedValue(mockCredential);
      mockDecryptWithKey.mockReturnValue(decryptedValue);

      const result = await service.decryptCredential(
        validHexKey,
        mockCredential.id,
      );

      expect(mockFindById).toHaveBeenCalledWith(mockCredential.id);
      expect(mockDecryptWithKey).toHaveBeenCalledWith(
        mockCredential.credentialsEncrypted,
        Buffer.from(validHexKey, 'hex'),
      );
      expect(result).toEqual(decryptedValue);
    });

    it('should throw BadRequestException for key with invalid length', async () => {
      mockFindById.mockResolvedValue(mockCredential);

      const shortKey = 'tooshort';

      await expect(
        service.decryptCredential(shortKey, mockCredential.id),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.decryptCredential(shortKey, mockCredential.id),
      ).rejects.toThrow(
        `Invalid key format. Expected 64 hex characters (32 bytes) but got ${shortKey.length} characters.`,
      );
    });

    it('should throw BadRequestException for invalid hexadecimal key', async () => {
      mockFindById.mockResolvedValue(mockCredential);

      const invalidHexKey =
        '0000000000000000000000000000000000000000000000000000000000000 00';

      await expect(
        service.decryptCredential(invalidHexKey, mockCredential.id),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when credential not found', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(
        service.decryptCredential(validHexKey, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);

      await expect(
        service.decryptCredential(validHexKey, 'nonexistent'),
      ).rejects.toThrow(
        `Connector credential with ID 'nonexistent' was not found.`,
      );
    });

    it('should throw BadRequestException on decryption failure', async () => {
      mockFindById.mockResolvedValue(mockCredential);
      mockDecryptWithKey.mockImplementation(() => {
        throw new Error('Authentication tag mismatch');
      });

      await expect(
        service.decryptCredential(validHexKey, mockCredential.id),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.decryptCredential(validHexKey, mockCredential.id),
      ).rejects.toThrow(/Failed to decrypt connector credential/);
    });
  });
});
