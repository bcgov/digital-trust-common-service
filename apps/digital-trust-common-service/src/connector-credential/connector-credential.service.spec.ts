import { AuthContext } from '@app/auth';
import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { EncryptionService } from '../common/crypto/encryption.service';
import { ConnectorType } from '../connection/connection.entity';
import { CredentialRepository } from '../credential/credential.repository';
import { TenantService } from '../tenant/tenant.service';

import { ConnectorCredential } from './connector-credential.entity';
import { ConnectorCredentialRepository } from './connector-credential.repository';
import { ConnectorCredentialService } from './connector-credential.service';
import { ConnectorHealthCheckService } from './connector-health-check.service';
import { CreateConnectorCredentialDto } from './dto/create-connector-credential.dto';
import { UpdateConnectorCredentialDto } from './dto/update-connector-credential.dto';

describe('ConnectorCredentialService', () => {
  let service: ConnectorCredentialService;
  let mockFindById: jest.Mock;
  let mockFindByTenant: jest.Mock;
  let mockFindByTenantAndConnectorType: jest.Mock;
  let mockFindByTenantAndConnectorTypeAndActive: jest.Mock;
  let mockCreate: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockDelete: jest.Mock;
  let mockDeactivateAllForTenant: jest.Mock;
  let mockTenantServiceFindById: jest.Mock;
  let mockEncrypt: jest.Mock;
  let mockDecrypt: jest.Mock;
  let mockRequiresRotation: jest.Mock;
  let mockHealthCheck: jest.Mock;
  let mockExistsByConnectorId: jest.Mock;

  const mockCredentials = { apiKey: 'sk_live_abc123' };

  const mockCredential: ConnectorCredential = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    tenantId: '123e4567-e89b-12d3-a456-426614174001',
    connectorType: ConnectorType.TRACTION,
    credentialsEncrypted: Buffer.from('encrypted_data'),
    endpointUrl: 'https://traction.example.com/api',
    active: true,
    keyVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    tenant: undefined as unknown as ConnectorCredential['tenant'],
  };

  const auth: AuthContext = {
    sub: 'user-1',
    tokenType: 'user',
    clientId: 'spa',
    tenantId: mockCredential.tenantId,
    roles: [],
    scope: 'tenants:admin',
    scopes: ['tenants:admin'],
    iss: 'http://localhost/oidc',
    aud: 'http://localhost/oidc',
    exp: 9_999_999_999,
    iat: 1,
  };

  beforeEach(async () => {
    mockFindById = jest.fn();
    mockFindByTenant = jest.fn();
    mockFindByTenantAndConnectorType = jest.fn();
    mockFindByTenantAndConnectorTypeAndActive = jest.fn();
    mockCreate = jest.fn();
    mockUpdate = jest.fn();
    mockDelete = jest.fn();
    mockDeactivateAllForTenant = jest.fn();
    mockTenantServiceFindById = jest
      .fn()
      .mockResolvedValue({ id: mockCredential.tenantId });
    mockEncrypt = jest.fn().mockReturnValue({
      ciphertext: Buffer.from('encrypted_data'),
      keyVersion: 1,
    });
    mockDecrypt = jest.fn().mockReturnValue(mockCredentials);
    mockRequiresRotation = jest.fn().mockReturnValue(false);
    mockHealthCheck = jest
      .fn()
      .mockResolvedValue({ status: 'healthy', latencyMs: 10 });
    mockExistsByConnectorId = jest.fn().mockResolvedValue(false);

    const mockRepository = {
      findById: mockFindById,
      findByTenant: mockFindByTenant,
      findByTenantAndConnectorType: mockFindByTenantAndConnectorType,
      findByTenantAndConnectorTypeAndActive:
        mockFindByTenantAndConnectorTypeAndActive,
      create: mockCreate,
      update: mockUpdate,
      delete: mockDelete,
      deactivateAllForTenant: mockDeactivateAllForTenant,
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
            decrypt: mockDecrypt,
            requiresRotation: mockRequiresRotation,
          },
        },
        {
          provide: ConnectorHealthCheckService,
          useValue: {
            check: mockHealthCheck,
          },
        },
        {
          provide: CredentialRepository,
          useValue: {
            existsByConnectorId: mockExistsByConnectorId,
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
    const dto: CreateConnectorCredentialDto = {
      connectorType: ConnectorType.TRACTION,
      endpointUrl: 'https://traction.example.com/api',
      credentials: mockCredentials,
    };

    it('should validate the tenant and run a health check before creating', async () => {
      mockCreate.mockResolvedValue(mockCredential);

      const result = await service.create(mockCredential.tenantId, dto, auth);

      expect(mockTenantServiceFindById).toHaveBeenCalledWith(
        mockCredential.tenantId,
      );
      expect(mockHealthCheck).toHaveBeenCalledWith(
        dto.connectorType,
        dto.endpointUrl,
        dto.credentials,
      );
      expect(mockEncrypt).toHaveBeenCalledWith(dto.credentials);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: mockCredential.tenantId,
          connectorType: dto.connectorType,
          endpointUrl: dto.endpointUrl,
          active: true,
        }),
      );
      expect(result).toEqual(mockCredential);
    });

    it('should throw TenantAccessDeniedException when the caller tenant does not match', async () => {
      const otherAuth: AuthContext = { ...auth, tenantId: 'other-tenant' };

      await expect(
        service.create(mockCredential.tenantId, dto, otherAuth),
      ).rejects.toThrow();

      expect(mockHealthCheck).not.toHaveBeenCalled();
    });

    it('should throw UnprocessableEntityException when the health check fails', async () => {
      mockHealthCheck.mockResolvedValue({
        status: 'unhealthy',
        latencyMs: 10,
        message: 'connection refused',
      });

      await expect(
        service.create(mockCredential.tenantId, dto, auth),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(mockEncrypt).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should find a credential by ID', async () => {
      mockFindById.mockResolvedValue(mockCredential);

      const result = await service.findById(mockCredential.id, auth);

      expect(mockFindById).toHaveBeenCalledWith(mockCredential.id);
      expect(result).toEqual(mockCredential);
    });

    it('should throw NotFoundException if credential not found', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(service.findById('nonexistent', auth)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when auth is omitted', async () => {
      mockFindById.mockResolvedValue(mockCredential);

      await expect(service.findById(mockCredential.id)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException for a cross-tenant caller', async () => {
      mockFindById.mockResolvedValue(mockCredential);
      const otherAuth: AuthContext = { ...auth, tenantId: 'other-tenant' };

      await expect(
        service.findById(mockCredential.id, otherAuth),
      ).rejects.toThrow(NotFoundException);
    });

    it('should lazily rotate the encryption key when required', async () => {
      mockFindById.mockResolvedValue({ ...mockCredential });
      mockRequiresRotation.mockReturnValue(true);

      await service.findById(mockCredential.id, auth);

      expect(mockDecrypt).toHaveBeenCalledWith(
        mockCredential.credentialsEncrypted,
        mockCredential.keyVersion,
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        mockCredential.id,
        expect.objectContaining({
          credentialsEncrypted: expect.any(Buffer),
          keyVersion: expect.any(Number),
        }),
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

    it('should return an empty array when there are no credentials', async () => {
      mockFindByTenant.mockResolvedValue([]);

      const result = await service.findByTenant(mockCredential.tenantId);

      expect(result).toEqual([]);
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
    it('should update the endpoint URL without running a health check', async () => {
      const dto: UpdateConnectorCredentialDto = {
        endpointUrl: 'https://traction.example.com/api/v2',
      };
      const updatedCredential = {
        ...mockCredential,
        endpointUrl: dto.endpointUrl,
      };

      mockFindById.mockResolvedValue(mockCredential);
      mockUpdate.mockResolvedValue(updatedCredential);

      const result = await service.update(mockCredential.id, dto, auth);

      expect(mockHealthCheck).not.toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalledWith(mockCredential.id, {
        endpointUrl: dto.endpointUrl,
      });
      expect(result).toEqual(updatedCredential);
    });

    it('should re-run the health check and re-encrypt when rotating credentials', async () => {
      const dto: UpdateConnectorCredentialDto = {
        credentials: { apiKey: 'sk_live_new456' },
      };

      mockFindById.mockResolvedValue(mockCredential);
      mockUpdate.mockResolvedValue(mockCredential);

      await service.update(mockCredential.id, dto, auth);

      expect(mockHealthCheck).toHaveBeenCalledWith(
        mockCredential.connectorType,
        mockCredential.endpointUrl,
        dto.credentials,
      );
      expect(mockEncrypt).toHaveBeenCalledWith(dto.credentials);
      expect(mockUpdate).toHaveBeenCalledWith(
        mockCredential.id,
        expect.objectContaining({
          credentialsEncrypted: expect.any(Buffer),
          keyVersion: expect.any(Number),
        }),
      );
    });

    it('should throw UnprocessableEntityException when rotation health check fails', async () => {
      const dto: UpdateConnectorCredentialDto = {
        credentials: { apiKey: 'sk_live_new456' },
      };

      mockFindById.mockResolvedValue(mockCredential);
      mockHealthCheck.mockResolvedValue({
        status: 'unhealthy',
        latencyMs: 10,
        message: 'unauthorized',
      });

      await expect(
        service.update(mockCredential.id, dto, auth),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if credential not found during update', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(
        service.update('nonexistent', { endpointUrl: 'https://x.com' }, auth),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('should delete a connector credential with no dependents', async () => {
      mockFindById.mockResolvedValue(mockCredential);
      mockExistsByConnectorId.mockResolvedValue(false);
      mockDelete.mockResolvedValue(undefined);

      await service.delete(mockCredential.id, auth);

      expect(mockExistsByConnectorId).toHaveBeenCalledWith(mockCredential.id);
      expect(mockDelete).toHaveBeenCalledWith(mockCredential.id);
    });

    it('should throw ConflictException when credential records still reference it', async () => {
      mockFindById.mockResolvedValue(mockCredential);
      mockExistsByConnectorId.mockResolvedValue(true);

      await expect(service.delete(mockCredential.id, auth)).rejects.toThrow(
        ConflictException,
      );

      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if credential not found during delete', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(service.delete('nonexistent', auth)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deactivateAllForTenant', () => {
    it('should delegate to the repository', async () => {
      mockDeactivateAllForTenant.mockResolvedValue(2);

      const result = await service.deactivateAllForTenant(
        mockCredential.tenantId,
      );

      expect(mockDeactivateAllForTenant).toHaveBeenCalledWith(
        mockCredential.tenantId,
      );
      expect(result).toBe(2);
    });
  });

  describe('testConnectivity', () => {
    it('should decrypt the stored credentials and run a health check', async () => {
      mockFindById.mockResolvedValue(mockCredential);
      mockHealthCheck.mockResolvedValue({ status: 'healthy', latencyMs: 5 });

      const result = await service.testConnectivity(mockCredential.id, auth);

      expect(mockDecrypt).toHaveBeenCalledWith(
        mockCredential.credentialsEncrypted,
        mockCredential.keyVersion,
      );
      expect(mockHealthCheck).toHaveBeenCalledWith(
        mockCredential.connectorType,
        mockCredential.endpointUrl,
        mockCredentials,
      );
      expect(result).toEqual({ status: 'healthy', latencyMs: 5 });
    });

    it('should throw NotFoundException if credential not found', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(
        service.testConnectivity('nonexistent', auth),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
