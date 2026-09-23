import { AuthContext } from '@app/auth';
import { OidcConfigService } from '@app/oidc/config';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { EncryptionService } from '../common/crypto/encryption.service';
import { ConnectorType } from '../connection/connection.entity';
import { CredentialRepository } from '../credential/credential.repository';
import { TenantService } from '../tenant/tenant.service';
import { TractionWebhookRegistrar } from '../traction/traction-webhook-registrar.service';

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
  let mockEnsureWebhookRegistered: jest.Mock;
  let mockIsWebhookRegistered: jest.Mock;
  let mockGetConfig: jest.Mock;

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
    mockEnsureWebhookRegistered = jest.fn().mockResolvedValue(undefined);
    // Verification defaults to "not registered", matching a registration
    // call that genuinely never reached Traction.
    mockIsWebhookRegistered = jest.fn().mockResolvedValue(false);
    mockGetConfig = jest
      .fn()
      .mockReturnValue({ publicUrl: 'https://app.localhost' });

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
        {
          provide: TractionWebhookRegistrar,
          useValue: {
            ensureWebhookRegistered: mockEnsureWebhookRegistered,
            isWebhookRegistered: mockIsWebhookRegistered,
          },
        },
        {
          provide: OidcConfigService,
          useValue: {
            getConfig: mockGetConfig,
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
    let dto: CreateConnectorCredentialDto;

    beforeEach(() => {
      dto = {
        connectorType: ConnectorType.TRACTION,
        endpointUrl: 'https://traction.example.com/api',
        credentials: { ...mockCredentials },
      };
    });

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

    it('should auto-generate a webhook secret and register the webhook for a Traction connector', async () => {
      mockCreate.mockResolvedValue(mockCredential);

      await service.create(mockCredential.tenantId, dto, auth);

      expect(dto.credentials.webhookSecret).toEqual(expect.any(String));
      expect(mockEnsureWebhookRegistered).toHaveBeenCalledWith(
        {
          connectorId: mockCredential.id,
          tenantId: mockCredential.tenantId,
          endpointUrl: mockCredential.endpointUrl,
          credentials: dto.credentials,
        },
        `https://app.localhost/api/v1/connectors/${mockCredential.id}/webhooks`,
        dto.credentials.webhookSecret,
      );
    });

    it('should not register a webhook for a non-Traction connector', async () => {
      mockCreate.mockResolvedValue({
        ...mockCredential,
        connectorType: ConnectorType.CREDO,
      });

      await service.create(
        mockCredential.tenantId,
        { ...dto, connectorType: ConnectorType.CREDO },
        auth,
      );

      expect(mockEnsureWebhookRegistered).not.toHaveBeenCalled();
    });

    it('should delete the credential row when registration fails and Traction confirms it was never applied', async () => {
      mockCreate.mockResolvedValue(mockCredential);
      const registrationError = new Error('Traction unreachable');
      mockEnsureWebhookRegistered.mockRejectedValue(registrationError);
      mockIsWebhookRegistered.mockResolvedValue(false);

      await expect(
        service.create(mockCredential.tenantId, dto, auth),
      ).rejects.toThrow(registrationError);

      expect(mockDelete).toHaveBeenCalledWith(mockCredential.id);
    });

    it('should keep the credential row when a failed registration call is confirmed to have applied remotely', async () => {
      mockCreate.mockResolvedValue(mockCredential);
      mockEnsureWebhookRegistered.mockRejectedValue(new Error('ETIMEDOUT'));
      mockIsWebhookRegistered.mockResolvedValue(true);

      const result = await service.create(mockCredential.tenantId, dto, auth);

      expect(mockDelete).not.toHaveBeenCalled();
      expect(result).toEqual(mockCredential);
    });

    it('should leave the credential row in place when the registration state cannot be verified', async () => {
      mockCreate.mockResolvedValue(mockCredential);
      const registrationError = new Error('Traction unreachable');
      mockEnsureWebhookRegistered.mockRejectedValue(registrationError);
      mockIsWebhookRegistered.mockRejectedValue(
        new Error('Traction unreachable'),
      );

      await expect(
        service.create(mockCredential.tenantId, dto, auth),
      ).rejects.toThrow(registrationError);

      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('should log rather than throw when the compensating delete also fails', async () => {
      mockCreate.mockResolvedValue(mockCredential);
      mockEnsureWebhookRegistered.mockRejectedValue(
        new Error('Traction unreachable'),
      );
      mockIsWebhookRegistered.mockResolvedValue(false);
      mockDelete.mockRejectedValue(new Error('DB unavailable'));

      await expect(
        service.create(mockCredential.tenantId, dto, auth),
      ).rejects.toThrow('Traction unreachable');
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

      const result = await service.findById(
        mockCredential.tenantId,
        mockCredential.id,
        auth,
      );

      expect(mockFindById).toHaveBeenCalledWith(mockCredential.id);
      expect(result).toEqual(mockCredential);
    });

    it('should throw NotFoundException if credential not found', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(
        service.findById(mockCredential.tenantId, 'nonexistent', auth),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when auth is omitted', async () => {
      mockFindById.mockResolvedValue(mockCredential);

      await expect(
        service.findById(mockCredential.tenantId, mockCredential.id),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException for a cross-tenant caller', async () => {
      mockFindById.mockResolvedValue(mockCredential);
      const otherAuth: AuthContext = { ...auth, tenantId: 'other-tenant' };

      await expect(
        service.findById(mockCredential.tenantId, mockCredential.id, otherAuth),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when the path tenantId does not match the credential', async () => {
      mockFindById.mockResolvedValue(mockCredential);

      await expect(
        service.findById('other-tenant', mockCredential.id, auth),
      ).rejects.toThrow(NotFoundException);
    });

    it('should lazily rotate the encryption key when required', async () => {
      mockFindById.mockResolvedValue({ ...mockCredential });
      mockRequiresRotation.mockReturnValue(true);

      await service.findById(mockCredential.tenantId, mockCredential.id, auth);

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

  describe('findActiveForWebhook', () => {
    it('should return the credential when it is active', async () => {
      mockFindById.mockResolvedValue(mockCredential);

      const result = await service.findActiveForWebhook(mockCredential.id);

      expect(mockFindById).toHaveBeenCalledWith(mockCredential.id);
      expect(result).toEqual(mockCredential);
    });

    it('should return null when no credential is found', async () => {
      mockFindById.mockResolvedValue(null);

      const result = await service.findActiveForWebhook('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null when the credential is inactive', async () => {
      mockFindById.mockResolvedValue({ ...mockCredential, active: false });

      const result = await service.findActiveForWebhook(mockCredential.id);

      expect(result).toBeNull();
    });

    it('should lazily rotate the encryption key when required', async () => {
      mockFindById.mockResolvedValue({ ...mockCredential });
      mockRequiresRotation.mockReturnValue(true);

      await service.findActiveForWebhook(mockCredential.id);

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
    it('should re-validate the endpoint against existing credentials when only the endpoint changes', async () => {
      const dto: UpdateConnectorCredentialDto = {
        endpointUrl: 'https://traction.example.com/api/v2',
      };
      const updatedCredential = {
        ...mockCredential,
        endpointUrl: dto.endpointUrl,
      };

      mockFindById.mockResolvedValue(mockCredential);
      mockUpdate.mockResolvedValue(updatedCredential);

      const result = await service.update(
        mockCredential.tenantId,
        mockCredential.id,
        dto,
        auth,
      );

      expect(mockDecrypt).toHaveBeenCalledWith(
        mockCredential.credentialsEncrypted,
        mockCredential.keyVersion,
      );
      expect(mockHealthCheck).toHaveBeenCalledWith(
        mockCredential.connectorType,
        dto.endpointUrl,
        mockCredentials,
      );
      expect(mockEncrypt).not.toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalledWith(mockCredential.id, {
        endpointUrl: dto.endpointUrl,
      });
      expect(result).toEqual(updatedCredential);
    });

    it('should throw UnprocessableEntityException when the new endpoint fails validation', async () => {
      const dto: UpdateConnectorCredentialDto = {
        endpointUrl: 'https://169.254.169.254/',
      };

      mockFindById.mockResolvedValue(mockCredential);
      mockHealthCheck.mockResolvedValue({
        status: 'unhealthy',
        latencyMs: 0,
        message: 'blocked host',
      });

      await expect(
        service.update(mockCredential.tenantId, mockCredential.id, dto, auth),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should re-run the health check and re-encrypt when rotating credentials', async () => {
      const dto: UpdateConnectorCredentialDto = {
        credentials: { apiKey: 'sk_live_new456' },
      };

      mockFindById.mockResolvedValue(mockCredential);
      mockUpdate.mockResolvedValue(mockCredential);

      await service.update(
        mockCredential.tenantId,
        mockCredential.id,
        dto,
        auth,
      );

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

    it('should preserve the existing webhook secret when rotating Traction credentials without one', async () => {
      mockDecrypt.mockReturnValue({
        ...mockCredentials,
        webhookSecret: 'whsec_existing',
      });
      const dto: UpdateConnectorCredentialDto = {
        credentials: { apiKey: 'sk_live_new456' },
      };

      mockFindById.mockResolvedValue(mockCredential);
      mockUpdate.mockResolvedValue(mockCredential);

      await service.update(
        mockCredential.tenantId,
        mockCredential.id,
        dto,
        auth,
      );

      expect(dto.credentials?.webhookSecret).toEqual('whsec_existing');
      expect(mockEncrypt).toHaveBeenCalledWith(
        expect.objectContaining({ webhookSecret: 'whsec_existing' }),
      );
      expect(mockEnsureWebhookRegistered).toHaveBeenCalledWith(
        {
          connectorId: mockCredential.id,
          tenantId: mockCredential.tenantId,
          endpointUrl: mockCredential.endpointUrl,
          credentials: dto.credentials,
        },
        `https://app.localhost/api/v1/connectors/${mockCredential.id}/webhooks`,
        'whsec_existing',
      );
    });

    it('should re-register the webhook with a newly-rotated secret', async () => {
      const dto: UpdateConnectorCredentialDto = {
        credentials: {
          apiKey: 'sk_live_new456',
          webhookSecret: 'whsec_rotated',
        },
      };

      mockFindById.mockResolvedValue(mockCredential);
      mockUpdate.mockResolvedValue(mockCredential);

      await service.update(
        mockCredential.tenantId,
        mockCredential.id,
        dto,
        auth,
      );

      expect(mockEnsureWebhookRegistered).toHaveBeenCalledWith(
        {
          connectorId: mockCredential.id,
          tenantId: mockCredential.tenantId,
          endpointUrl: mockCredential.endpointUrl,
          credentials: dto.credentials,
        },
        `https://app.localhost/api/v1/connectors/${mockCredential.id}/webhooks`,
        'whsec_rotated',
      );
    });

    it('should revert the persisted credentials when webhook re-registration fails and Traction confirms it was never applied', async () => {
      const dto: UpdateConnectorCredentialDto = {
        endpointUrl: 'https://traction.example.com/api/v2',
        credentials: {
          apiKey: 'sk_live_new456',
          webhookSecret: 'whsec_rotated',
        },
      };
      const registrationError = new Error('Traction unreachable');

      mockFindById.mockResolvedValue(mockCredential);
      mockUpdate.mockResolvedValue(mockCredential);
      mockEnsureWebhookRegistered.mockRejectedValue(registrationError);
      mockIsWebhookRegistered.mockResolvedValue(false);

      await expect(
        service.update(mockCredential.tenantId, mockCredential.id, dto, auth),
      ).rejects.toThrow(registrationError);

      expect(mockUpdate).toHaveBeenNthCalledWith(
        1,
        mockCredential.id,
        expect.objectContaining({
          credentialsEncrypted: mockCredential.credentialsEncrypted,
          keyVersion: mockCredential.keyVersion,
          endpointUrl: mockCredential.endpointUrl,
        }),
      );
    });

    it('should keep the persisted update when a failed re-registration call is confirmed to have applied remotely', async () => {
      const dto: UpdateConnectorCredentialDto = {
        credentials: {
          apiKey: 'sk_live_new456',
          webhookSecret: 'whsec_rotated',
        },
      };

      mockFindById.mockResolvedValue(mockCredential);
      mockUpdate.mockResolvedValue(mockCredential);
      mockEnsureWebhookRegistered.mockRejectedValue(new Error('ETIMEDOUT'));
      mockIsWebhookRegistered.mockResolvedValue(true);

      const result = await service.update(
        mockCredential.tenantId,
        mockCredential.id,
        dto,
        auth,
      );

      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockCredential);
    });

    it('should leave the persisted update in place when the registration state cannot be verified', async () => {
      const dto: UpdateConnectorCredentialDto = {
        credentials: {
          apiKey: 'sk_live_new456',
          webhookSecret: 'whsec_rotated',
        },
      };
      const registrationError = new Error('Traction unreachable');

      mockFindById.mockResolvedValue(mockCredential);
      mockUpdate.mockResolvedValue(mockCredential);
      mockEnsureWebhookRegistered.mockRejectedValue(registrationError);
      mockIsWebhookRegistered.mockRejectedValue(
        new Error('Traction unreachable'),
      );

      await expect(
        service.update(mockCredential.tenantId, mockCredential.id, dto, auth),
      ).rejects.toThrow(registrationError);

      expect(mockUpdate).toHaveBeenCalledTimes(0);
    });

    it('should log rather than throw when the compensating revert also fails', async () => {
      const dto: UpdateConnectorCredentialDto = {
        credentials: { apiKey: 'sk_live_new456' },
      };

      mockFindById.mockResolvedValue(mockCredential);
      mockUpdate
        .mockResolvedValueOnce(mockCredential)
        .mockRejectedValueOnce(new Error('DB unavailable'));
      mockEnsureWebhookRegistered.mockRejectedValue(
        new Error('Traction unreachable'),
      );
      mockIsWebhookRegistered.mockResolvedValue(false);

      await expect(
        service.update(mockCredential.tenantId, mockCredential.id, dto, auth),
      ).rejects.toThrow('Traction unreachable');
    });

    it('should not re-register the webhook for a non-Traction connector', async () => {
      const nonTractionCredential = {
        ...mockCredential,
        connectorType: ConnectorType.CREDO,
      };
      const dto: UpdateConnectorCredentialDto = {
        credentials: { apiKey: 'sk_live_new456' },
      };

      mockFindById.mockResolvedValue(nonTractionCredential);
      mockUpdate.mockResolvedValue(nonTractionCredential);

      await service.update(
        mockCredential.tenantId,
        mockCredential.id,
        dto,
        auth,
      );

      expect(mockEnsureWebhookRegistered).not.toHaveBeenCalled();
    });

    it('should not re-register the webhook when only the endpoint changes', async () => {
      const dto: UpdateConnectorCredentialDto = {
        endpointUrl: 'https://traction.example.com/api/v2',
      };

      mockFindById.mockResolvedValue(mockCredential);
      mockUpdate.mockResolvedValue({
        ...mockCredential,
        endpointUrl: dto.endpointUrl,
      });

      await service.update(
        mockCredential.tenantId,
        mockCredential.id,
        dto,
        auth,
      );

      expect(mockEnsureWebhookRegistered).not.toHaveBeenCalled();
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
        service.update(mockCredential.tenantId, mockCredential.id, dto, auth),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if credential not found during update', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(
        service.update(
          mockCredential.tenantId,
          'nonexistent',
          { endpointUrl: 'https://x.com' },
          auth,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when no fields are provided', async () => {
      mockFindById.mockResolvedValue(mockCredential);

      await expect(
        service.update(mockCredential.tenantId, mockCredential.id, {}, auth),
      ).rejects.toThrow(BadRequestException);

      expect(mockHealthCheck).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete a connector credential with no dependents', async () => {
      mockFindById.mockResolvedValue(mockCredential);
      mockExistsByConnectorId.mockResolvedValue(false);
      mockDelete.mockResolvedValue(undefined);

      await service.delete(mockCredential.tenantId, mockCredential.id, auth);

      expect(mockExistsByConnectorId).toHaveBeenCalledWith(mockCredential.id);
      expect(mockDelete).toHaveBeenCalledWith(mockCredential.id);
    });

    it('should throw ConflictException when credential records still reference it', async () => {
      mockFindById.mockResolvedValue(mockCredential);
      mockExistsByConnectorId.mockResolvedValue(true);

      await expect(
        service.delete(mockCredential.tenantId, mockCredential.id, auth),
      ).rejects.toThrow(ConflictException);

      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if credential not found during delete', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(
        service.delete(mockCredential.tenantId, 'nonexistent', auth),
      ).rejects.toThrow(NotFoundException);
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

      const result = await service.testConnectivity(
        mockCredential.tenantId,
        mockCredential.id,
        auth,
      );

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
        service.testConnectivity(mockCredential.tenantId, 'nonexistent', auth),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
