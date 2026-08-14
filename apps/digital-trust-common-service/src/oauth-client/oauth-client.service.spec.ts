import { OidcConfigService } from '@app/oidc/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { CreateOAuthClientDto } from './dto/create-oauth-client.dto';
import { OAuthClient } from './oauth-client.entity';
import { OAuthClientRepository } from './oauth-client.repository';
import { OAuthClientService } from './oauth-client.service';

// Mock argon2 before importing service
jest.mock('argon2', () => ({
  hash: jest.fn().mockResolvedValue('hashed_secret'),
  verify: jest.fn(),
  argon2i: 'argon2i',
}));

describe('OAuthClientService', () => {
  let service: OAuthClientService;
  let mockFindById: jest.Mock;
  let mockFindByClientId: jest.Mock;
  let mockFindByTenant: jest.Mock;
  let mockCreate: jest.Mock;
  let mockRevoke: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockGetConfig: jest.Mock;
  let mockRepository: any;
  let createService: () => Promise<OAuthClientService>;

  const mockOAuthClient: OAuthClient = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    tenantId: '123e4567-e89b-12d3-a456-426614174001',
    clientId: 'client_abc123',
    clientSecretHash: 'hashed_secret',
    name: 'Test Client',
    scopes: ['credentials:offer'],
    redirectUris: ['https://example.com/callback'],
    grantTypes: ['client_credentials'],
    roles: [],
    createdBy: '123e4567-e89b-12d3-a456-426614174002',
    createdAt: new Date(),
    tenant: undefined as any,
  };

  beforeEach(async () => {
    mockFindById = jest.fn();
    mockFindByClientId = jest.fn();
    mockFindByTenant = jest.fn();
    mockCreate = jest.fn();
    mockRevoke = jest.fn();
    mockUpdate = jest.fn();
    mockGetConfig = jest
      .fn()
      .mockReturnValue({ grantTypes: ['client_credentials'] });

    mockRepository = {
      findOne: jest.fn(),
    };

    const mockOAuthClientRepository = {
      findById: mockFindById,
      findByClientId: mockFindByClientId,
      findByTenant: mockFindByTenant,
      create: mockCreate,
      revoke: mockRevoke,
      update: mockUpdate,
      repository: mockRepository,
    };

    // OAuthClientService captures the grant-type allowlist at construction,
    // so tests that need a different allowlist rebuild the service after
    // adjusting mockGetConfig.
    createService = async (): Promise<OAuthClientService> => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OAuthClientService,
          {
            provide: OAuthClientRepository,
            useValue: mockOAuthClientRepository,
          },
          {
            provide: OidcConfigService,
            useValue: { getConfig: mockGetConfig },
          },
        ],
      }).compile();

      return module.get<OAuthClientService>(OAuthClientService);
    };

    service = await createService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createClient', () => {
    it('should create a new OAuth client with generated credentials', async () => {
      const dto: CreateOAuthClientDto = {
        tenantId: mockOAuthClient.tenantId,
        name: mockOAuthClient.name,
        scopes: mockOAuthClient.scopes,
        redirectUris: mockOAuthClient.redirectUris,
        createdBy: mockOAuthClient.createdBy,
      };

      mockCreate.mockResolvedValue(mockOAuthClient);

      const result = await service.createClient(dto);

      expect(result.client).toBeDefined();
      expect(result.clientSecret).toBeDefined();
      expect(result.clientSecret).toHaveLength(64); // hex string of 32 bytes
      expect(mockCreate).toHaveBeenCalled();
    });

    it('should reject an unsupported grant type', async () => {
      const dto: CreateOAuthClientDto = {
        tenantId: mockOAuthClient.tenantId,
        name: mockOAuthClient.name,
        grantTypes: ['authorization_code'],
      };

      await expect(service.createClient(dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should accept a grant type the OIDC configuration enables', async () => {
      mockGetConfig.mockReturnValue({
        grantTypes: ['client_credentials', 'refresh_token'],
      });
      service = await createService();
      mockCreate.mockResolvedValue(mockOAuthClient);

      const dto: CreateOAuthClientDto = {
        tenantId: mockOAuthClient.tenantId,
        name: mockOAuthClient.name,
        grantTypes: ['refresh_token'],
      };

      await expect(service.createClient(dto)).resolves.toBeDefined();
      expect(mockCreate).toHaveBeenCalled();
    });

    it('should default an omitted grant type to the configured allowlist', async () => {
      mockGetConfig.mockReturnValue({
        grantTypes: ['client_credentials', 'refresh_token'],
      });
      service = await createService();
      mockCreate.mockResolvedValue(mockOAuthClient);

      await service.createClient({
        tenantId: mockOAuthClient.tenantId,
        name: mockOAuthClient.name,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          grantTypes: ['client_credentials', 'refresh_token'],
        }),
      );
    });

    it('should persist roles when provided on create', async () => {
      mockCreate.mockResolvedValue({
        ...mockOAuthClient,
        roles: ['platform-admin'],
      });

      await service.createClient({
        tenantId: mockOAuthClient.tenantId,
        name: mockOAuthClient.name,
        roles: ['platform-admin'],
        grantTypes: ['client_credentials'],
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          roles: ['platform-admin'],
        }),
      );
    });

    it('should reject unknown roles on create', async () => {
      await expect(
        service.createClient({
          tenantId: mockOAuthClient.tenantId,
          name: mockOAuthClient.name,
          roles: ['superuser'],
          grantTypes: ['client_credentials'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should reject roles when grant types are not client_credentials-only', async () => {
      mockGetConfig.mockReturnValue({
        grantTypes: ['client_credentials', 'authorization_code'],
      });
      service = await createService();

      await expect(
        service.createClient({
          tenantId: mockOAuthClient.tenantId,
          name: mockOAuthClient.name,
          roles: ['platform-admin'],
          grantTypes: ['client_credentials', 'authorization_code'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('findByClientId', () => {
    it('should find an OAuth client by client ID', async () => {
      mockFindByClientId.mockResolvedValue(mockOAuthClient);

      const result = await service.findByClientId(mockOAuthClient.clientId);

      expect(mockFindByClientId).toHaveBeenCalledWith(mockOAuthClient.clientId);
      expect(result).toEqual(mockOAuthClient);
    });

    it('should throw NotFoundException if client not found', async () => {
      mockFindByClientId.mockResolvedValue(null);

      await expect(service.findByClientId('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByTenant', () => {
    it('should find all OAuth clients for a tenant', async () => {
      mockFindByTenant.mockResolvedValue([mockOAuthClient]);

      const result = await service.findByTenant(mockOAuthClient.tenantId);

      expect(mockFindByTenant).toHaveBeenCalledWith(mockOAuthClient.tenantId);
      expect(result).toEqual([mockOAuthClient]);
    });
  });

  describe('revokeClient', () => {
    it('should revoke an OAuth client', async () => {
      mockFindById.mockResolvedValue(mockOAuthClient);
      mockRevoke.mockResolvedValue(undefined);

      await service.revokeClient(mockOAuthClient.id);

      expect(mockFindById).toHaveBeenCalledWith(mockOAuthClient.id);
      expect(mockRevoke).toHaveBeenCalledWith(mockOAuthClient.id);
    });

    it('should throw NotFoundException if client not found', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(service.revokeClient('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('verifyClientSecret', () => {
    it('should verify a valid client secret', async () => {
      const clientSecret = 'test_secret_123';
      const clientWithHash: OAuthClient = {
        ...mockOAuthClient,
        clientSecretHash: 'hashed_secret',
        revokedAt: undefined,
      };

      mockFindByClientId.mockResolvedValue(clientWithHash);

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('argon2').verify as jest.Mock).mockResolvedValue(true);

      const result = await service.verifyClientSecret(
        mockOAuthClient.clientId,
        clientSecret,
      );

      expect(result).toBe(true);
    });

    it('should return false for invalid secret', async () => {
      mockFindByClientId.mockResolvedValue(mockOAuthClient);
      const clientWithHash: OAuthClient = {
        ...mockOAuthClient,
        clientSecretHash: 'hashed_secret',
        revokedAt: undefined,
      };

      mockFindByClientId.mockResolvedValue(clientWithHash);

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('argon2').verify as jest.Mock).mockResolvedValue(false);

      const result = await service.verifyClientSecret(
        mockOAuthClient.clientId,
        'wrong_secret',
      );

      expect(result).toBe(false);
    });

    it('should return false for revoked client', async () => {
      const revokedClient: OAuthClient = {
        ...mockOAuthClient,
        clientSecretHash: 'hashed_secret',
        revokedAt: new Date(),
      };

      mockFindByClientId.mockResolvedValue(revokedClient);

      const result = await service.verifyClientSecret(
        mockOAuthClient.clientId,
        'any_secret',
      );

      expect(result).toBe(false);
    });
  });

  describe('update', () => {
    it('should update an OAuth client with new values', async () => {
      mockFindById.mockResolvedValue(mockOAuthClient);
      const updatedClient = {
        ...mockOAuthClient,
        name: 'Updated Client',
        scopes: ['credentials:offer', 'credentials:verify'],
      };
      mockUpdate.mockResolvedValue(updatedClient);

      const result = await service.update(mockOAuthClient.id, {
        name: 'Updated Client',
        scopes: ['credentials:offer', 'credentials:verify'],
      });

      expect(mockFindById).toHaveBeenCalledWith(mockOAuthClient.id);
      expect(mockUpdate).toHaveBeenCalled();
      expect(result.name).toBe('Updated Client');
      expect(result.scopes).toEqual([
        'credentials:offer',
        'credentials:verify',
      ]);
    });

    it('should update roles when provided', async () => {
      mockFindById.mockResolvedValue(mockOAuthClient);
      const updatedClient = {
        ...mockOAuthClient,
        roles: ['platform-admin'],
      };
      mockUpdate.mockResolvedValue(updatedClient);

      const result = await service.update(mockOAuthClient.id, {
        roles: ['platform-admin'],
      });

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          roles: ['platform-admin'],
        }),
      );
      expect(result.roles).toEqual(['platform-admin']);
    });

    it('should reject unknown roles on update', async () => {
      mockFindById.mockResolvedValue(mockOAuthClient);

      await expect(
        service.update(mockOAuthClient.id, {
          roles: ['superuser'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should reject adding interactive grants to a client with roles', async () => {
      mockGetConfig.mockReturnValue({
        grantTypes: ['client_credentials', 'authorization_code'],
      });
      service = await createService();
      mockFindById.mockResolvedValue({
        ...mockOAuthClient,
        roles: ['platform-admin'],
        grantTypes: ['client_credentials'],
      });

      await expect(
        service.update(mockOAuthClient.id, {
          grantTypes: ['client_credentials', 'authorization_code'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should reject adding roles to a non-machine client', async () => {
      mockGetConfig.mockReturnValue({
        grantTypes: ['client_credentials', 'authorization_code'],
      });
      service = await createService();
      mockFindById.mockResolvedValue({
        ...mockOAuthClient,
        roles: [],
        grantTypes: ['authorization_code'],
      });

      await expect(
        service.update(mockOAuthClient.id, {
          roles: ['platform-admin'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should update redirectUris and grantTypes when provided', async () => {
      mockFindById.mockResolvedValue(mockOAuthClient);
      const updatedClient = {
        ...mockOAuthClient,
        redirectUris: ['https://updated.example.com/callback'],
        grantTypes: ['client_credentials'],
      };
      mockUpdate.mockResolvedValue(updatedClient);

      const result = await service.update(mockOAuthClient.id, {
        redirectUris: ['https://updated.example.com/callback'],
        grantTypes: ['client_credentials'],
      });

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          redirectUris: ['https://updated.example.com/callback'],
          grantTypes: ['client_credentials'],
        }),
      );
      expect(result.redirectUris).toEqual([
        'https://updated.example.com/callback',
      ]);
      expect(result.grantTypes).toEqual(['client_credentials']);
    });

    it('sets a per-client refresh token TTL', async () => {
      mockFindById.mockResolvedValue({ ...mockOAuthClient });
      mockUpdate.mockImplementation((client: unknown) => client);

      await service.update(mockOAuthClient.id, {
        refreshTokenTtlSeconds: 3600,
      });

      expect(mockUpdate.mock.calls[0][0].refreshTokenTtlSeconds).toBe(3600);
    });

    it('clears the TTL override when explicitly set to null', async () => {
      mockFindById.mockResolvedValue({
        ...mockOAuthClient,
        refreshTokenTtlSeconds: 3600,
      });
      mockUpdate.mockImplementation((client: unknown) => client);

      await service.update(mockOAuthClient.id, {
        refreshTokenTtlSeconds: null,
      });

      expect(mockUpdate.mock.calls[0][0].refreshTokenTtlSeconds).toBeNull();
    });

    it('leaves the TTL untouched when the field is omitted', async () => {
      mockFindById.mockResolvedValue({
        ...mockOAuthClient,
        refreshTokenTtlSeconds: 3600,
      });
      mockUpdate.mockImplementation((client: unknown) => client);

      await service.update(mockOAuthClient.id, { name: 'Renamed' });

      expect(mockUpdate.mock.calls[0][0].refreshTokenTtlSeconds).toBe(3600);
    });

    it('should preserve existing values when partial update is provided', async () => {
      mockFindById.mockResolvedValue(mockOAuthClient);
      const updatedClient = {
        ...mockOAuthClient,
        name: 'Updated Name',
      };
      mockUpdate.mockResolvedValue(updatedClient);

      const result = await service.update(mockOAuthClient.id, {
        name: 'Updated Name',
      });

      expect(result.name).toBe('Updated Name');
      expect(result.scopes).toEqual(mockOAuthClient.scopes);
      expect(result.redirectUris).toEqual(mockOAuthClient.redirectUris);
    });

    it('should throw NotFoundException if client not found', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(
        service.update('nonexistent', { name: 'Updated Name' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject an unsupported grant type', async () => {
      await expect(
        service.update(mockOAuthClient.id, {
          grantTypes: ['authorization_code'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockFindById).not.toHaveBeenCalled();
    });
  });
});
