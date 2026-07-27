import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { EncryptionService } from '../common/crypto/encryption.service';
import { ConnectorType } from '../connection/connection.entity';

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
          provide: EncryptionService,
          useValue: {
            encrypt: jest.fn().mockReturnValue({
              ciphertext: Buffer.from('encrypted_data'),
              keyVersion: 1,
            }),
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
        keyVersion: mockCredential.keyVersion,
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
});
