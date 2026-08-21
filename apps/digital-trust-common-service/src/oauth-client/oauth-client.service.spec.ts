import {
  AuthenticationRequiredException,
  ScopeAuthorizationService,
  type AuthContext,
} from '@app/auth';
import { OidcConfigService } from '@app/oidc/config';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { CreateOAuthClientDto } from './dto/create-oauth-client.dto';
import { OAUTH_CLIENT_ID_PREFIX } from './oauth-client.constants';
import { OAuthClient } from './oauth-client.entity';
import { OAuthClientRepository } from './oauth-client.repository';
import { OAuthClientService } from './oauth-client.service';

// Mock argon2 before importing service
jest.mock('argon2', () => ({
  hash: jest.fn().mockResolvedValue('hashed_secret'),
  verify: jest.fn(),
  argon2i: 'argon2i',
}));

const CONFIGURED_SCOPES = [
  'tenants:admin',
  'credentials:offer',
  'credentials:verify',
  'credentials:hold',
  'credentials:revoke',
  'connections:manage',
  'profiles:manage',
  'users:manage',
  'clients:manage',
  'logs:read',
  'audit:read',
];

describe('OAuthClientService', () => {
  let service: OAuthClientService;
  let mockFindById: jest.Mock;
  let mockFindByClientId: jest.Mock;
  let mockFindByTenant: jest.Mock;
  let mockFindByTenantAndClientId: jest.Mock;
  let mockCreate: jest.Mock;
  let mockRevoke: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockGetConfig: jest.Mock;
  let createService: () => Promise<OAuthClientService>;

  const mockOAuthClient: OAuthClient = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    tenantId: '123e4567-e89b-12d3-a456-426614174001',
    clientId: 'dtcs_abc123',
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

  const tenantAdminAuth: AuthContext = {
    sub: '123e4567-e89b-12d3-a456-426614174002',
    tokenType: 'user',
    clientId: null,
    tenantId: mockOAuthClient.tenantId,
    roles: [],
    scope: 'tenants:admin',
    scopes: ['tenants:admin'],
    iss: 'https://example.test/oidc',
    aud: 'https://digital-trust-common-service',
    exp: 9_999_999_999,
    iat: 1,
  };

  const platformAdminAuth: AuthContext = {
    ...tenantAdminAuth,
    sub: 'platform-admin-1',
    roles: ['platform-admin'],
    scope: '',
    scopes: [],
  };

  const clientsManageAuth: AuthContext = {
    ...tenantAdminAuth,
    sub: 'clients-manage-1',
    scope: 'clients:manage',
    scopes: ['clients:manage'],
  };

  beforeEach(async () => {
    mockFindById = jest.fn();
    mockFindByClientId = jest.fn();
    mockFindByTenant = jest.fn();
    mockFindByTenantAndClientId = jest.fn();
    mockCreate = jest.fn();
    mockRevoke = jest.fn();
    mockUpdate = jest.fn();
    mockGetConfig = jest.fn().mockReturnValue({
      grantTypes: ['client_credentials'],
      scopes: CONFIGURED_SCOPES,
    });

    const mockOAuthClientRepository = {
      findById: mockFindById,
      findByClientId: mockFindByClientId,
      findByTenant: mockFindByTenant,
      findByTenantAndClientId: mockFindByTenantAndClientId,
      create: mockCreate,
      revoke: mockRevoke,
      update: mockUpdate,
    };

    createService = async (): Promise<OAuthClientService> => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          OAuthClientService,
          ScopeAuthorizationService,
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
        name: mockOAuthClient.name,
        scopes: mockOAuthClient.scopes,
        redirectUris: mockOAuthClient.redirectUris,
      };

      mockCreate.mockResolvedValue(mockOAuthClient);

      const result = await service.createClient(
        mockOAuthClient.tenantId,
        dto,
        tenantAdminAuth,
      );

      expect(result.client).toBeDefined();
      expect(result.clientSecret).toBeDefined();
      expect(result.clientSecret).toHaveLength(64);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: mockOAuthClient.tenantId,
          createdBy: tenantAdminAuth.sub,
          grantTypes: ['client_credentials'],
        }),
      );
      expect(mockCreate.mock.calls[0][0].clientId).toMatch(
        new RegExp(`^${OAUTH_CLIENT_ID_PREFIX}[0-9a-f]{32}$`),
      );
    });

    it('should reject an unsupported grant type', async () => {
      const dto: CreateOAuthClientDto = {
        name: mockOAuthClient.name,
        scopes: mockOAuthClient.scopes,
        grantTypes: ['authorization_code'],
      };

      await expect(
        service.createClient(mockOAuthClient.tenantId, dto, tenantAdminAuth),
      ).rejects.toThrow(BadRequestException);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should accept a grant type the OIDC configuration enables', async () => {
      mockGetConfig.mockReturnValue({
        grantTypes: ['client_credentials', 'refresh_token'],
        scopes: CONFIGURED_SCOPES,
      });
      service = await createService();
      mockCreate.mockResolvedValue(mockOAuthClient);

      const dto: CreateOAuthClientDto = {
        name: mockOAuthClient.name,
        scopes: mockOAuthClient.scopes,
        grantTypes: ['refresh_token'],
      };

      await expect(
        service.createClient(mockOAuthClient.tenantId, dto, tenantAdminAuth),
      ).resolves.toBeDefined();
      expect(mockCreate).toHaveBeenCalled();
    });

    it('should default an omitted grant type to client_credentials', async () => {
      mockGetConfig.mockReturnValue({
        grantTypes: ['client_credentials', 'refresh_token'],
        scopes: CONFIGURED_SCOPES,
      });
      service = await createService();
      mockCreate.mockResolvedValue(mockOAuthClient);

      await service.createClient(
        mockOAuthClient.tenantId,
        {
          name: mockOAuthClient.name,
          scopes: mockOAuthClient.scopes,
        },
        tenantAdminAuth,
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          grantTypes: ['client_credentials'],
        }),
      );
    });

    it('should persist roles when a platform-admin assigns them', async () => {
      mockCreate.mockResolvedValue({
        ...mockOAuthClient,
        roles: ['platform-admin'],
      });

      await service.createClient(
        mockOAuthClient.tenantId,
        {
          name: mockOAuthClient.name,
          scopes: mockOAuthClient.scopes,
          roles: ['platform-admin'],
          grantTypes: ['client_credentials'],
        },
        platformAdminAuth,
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          roles: ['platform-admin'],
        }),
      );
    });

    it('should reject role assignment from a non-platform-admin caller', async () => {
      await expect(
        service.createClient(
          mockOAuthClient.tenantId,
          {
            name: mockOAuthClient.name,
            scopes: mockOAuthClient.scopes,
            roles: ['platform-admin'],
            grantTypes: ['client_credentials'],
          },
          tenantAdminAuth,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should reject unknown roles on create', async () => {
      await expect(
        service.createClient(
          mockOAuthClient.tenantId,
          {
            name: mockOAuthClient.name,
            scopes: mockOAuthClient.scopes,
            roles: ['superuser'],
            grantTypes: ['client_credentials'],
          },
          platformAdminAuth,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should reject roles when grant types are not client_credentials-only', async () => {
      mockGetConfig.mockReturnValue({
        grantTypes: ['client_credentials', 'authorization_code'],
        scopes: CONFIGURED_SCOPES,
      });
      service = await createService();

      await expect(
        service.createClient(
          mockOAuthClient.tenantId,
          {
            name: mockOAuthClient.name,
            scopes: mockOAuthClient.scopes,
            roles: ['platform-admin'],
            grantTypes: ['client_credentials', 'authorization_code'],
          },
          platformAdminAuth,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should reject unknown scopes', async () => {
      await expect(
        service.createClient(
          mockOAuthClient.tenantId,
          {
            name: mockOAuthClient.name,
            scopes: ['not:a-real-scope'],
          },
          tenantAdminAuth,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should reject scopes not enabled on the deployment', async () => {
      mockGetConfig.mockReturnValue({
        grantTypes: ['client_credentials'],
        scopes: ['credentials:offer'],
      });
      service = await createService();

      await expect(
        service.createClient(
          mockOAuthClient.tenantId,
          {
            name: mockOAuthClient.name,
            scopes: ['credentials:verify'],
          },
          tenantAdminAuth,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should reject scopes the caller does not hold', async () => {
      await expect(
        service.createClient(
          mockOAuthClient.tenantId,
          {
            name: mockOAuthClient.name,
            scopes: ['credentials:offer'],
          },
          clientsManageAuth,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should allow a clients:manage caller to grant only that scope', async () => {
      mockCreate.mockResolvedValue({
        ...mockOAuthClient,
        scopes: ['clients:manage'],
      });

      await service.createClient(
        mockOAuthClient.tenantId,
        {
          name: mockOAuthClient.name,
          scopes: ['clients:manage'],
        },
        clientsManageAuth,
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          scopes: ['clients:manage'],
        }),
      );
    });

    it('should allow platform-admin to grant any catalog scope', async () => {
      mockCreate.mockResolvedValue(mockOAuthClient);

      await service.createClient(
        mockOAuthClient.tenantId,
        {
          name: mockOAuthClient.name,
          scopes: ['credentials:offer', 'tenants:admin'],
        },
        platformAdminAuth,
      );

      expect(mockCreate).toHaveBeenCalled();
    });

    it('omits createdBy when the caller is a machine client', async () => {
      mockCreate.mockResolvedValue(mockOAuthClient);

      await service.createClient(
        mockOAuthClient.tenantId,
        {
          name: mockOAuthClient.name,
          scopes: mockOAuthClient.scopes,
        },
        {
          ...tenantAdminAuth,
          tokenType: 'client',
          clientId: 'dtcs_caller',
          sub: 'dtcs_caller',
        },
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          createdBy: undefined,
        }),
      );
    });

    it('should reject create without an authenticated caller', async () => {
      await expect(
        service.createClient(mockOAuthClient.tenantId, {
          name: mockOAuthClient.name,
          scopes: mockOAuthClient.scopes,
        }),
      ).rejects.toBeInstanceOf(AuthenticationRequiredException);
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
      mockFindByTenantAndClientId.mockResolvedValue(mockOAuthClient);
      mockRevoke.mockResolvedValue(undefined);

      await service.revokeClient(
        mockOAuthClient.tenantId,
        mockOAuthClient.clientId,
      );

      expect(mockFindByTenantAndClientId).toHaveBeenCalledWith(
        mockOAuthClient.tenantId,
        mockOAuthClient.clientId,
      );
      expect(mockRevoke).toHaveBeenCalledWith(mockOAuthClient.id);
    });

    it('should be idempotent when the client is already revoked', async () => {
      mockFindByTenantAndClientId.mockResolvedValue({
        ...mockOAuthClient,
        revokedAt: new Date(),
      });

      await service.revokeClient(
        mockOAuthClient.tenantId,
        mockOAuthClient.clientId,
      );

      expect(mockRevoke).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if client not found in the tenant', async () => {
      mockFindByTenantAndClientId.mockResolvedValue(null);

      await expect(
        service.revokeClient(mockOAuthClient.tenantId, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('rotateSecret', () => {
    it('should hash a new secret and return it once', async () => {
      mockFindByTenantAndClientId.mockResolvedValue({ ...mockOAuthClient });
      mockUpdate.mockImplementation((client: OAuthClient) => client);

      const result = await service.rotateSecret(
        mockOAuthClient.tenantId,
        mockOAuthClient.clientId,
      );

      expect(result.clientSecret).toHaveLength(64);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          clientSecretHash: 'hashed_secret',
        }),
      );
    });

    it('should throw NotFoundException for a revoked client', async () => {
      mockFindByTenantAndClientId.mockResolvedValue({
        ...mockOAuthClient,
        revokedAt: new Date(),
      });

      await expect(
        service.rotateSecret(
          mockOAuthClient.tenantId,
          mockOAuthClient.clientId,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockUpdate).not.toHaveBeenCalled();
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
      mockFindByTenantAndClientId.mockResolvedValue({ ...mockOAuthClient });
      const updatedClient = {
        ...mockOAuthClient,
        name: 'Updated Client',
        scopes: ['credentials:offer', 'credentials:verify'],
      };
      mockUpdate.mockResolvedValue(updatedClient);

      const result = await service.update(
        mockOAuthClient.tenantId,
        mockOAuthClient.clientId,
        {
          name: 'Updated Client',
          scopes: ['credentials:offer', 'credentials:verify'],
        },
        tenantAdminAuth,
      );

      expect(mockFindByTenantAndClientId).toHaveBeenCalledWith(
        mockOAuthClient.tenantId,
        mockOAuthClient.clientId,
      );
      expect(mockUpdate).toHaveBeenCalled();
      expect(result.name).toBe('Updated Client');
      expect(result.scopes).toEqual([
        'credentials:offer',
        'credentials:verify',
      ]);
    });

    it('should update roles when a platform-admin provides them', async () => {
      mockFindByTenantAndClientId.mockResolvedValue({ ...mockOAuthClient });
      const updatedClient = {
        ...mockOAuthClient,
        roles: ['platform-admin'],
      };
      mockUpdate.mockResolvedValue(updatedClient);

      const result = await service.update(
        mockOAuthClient.tenantId,
        mockOAuthClient.clientId,
        {
          roles: ['platform-admin'],
        },
        platformAdminAuth,
      );

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          roles: ['platform-admin'],
        }),
      );
      expect(result.roles).toEqual(['platform-admin']);
    });

    it('should reject unknown roles on update', async () => {
      mockFindByTenantAndClientId.mockResolvedValue({ ...mockOAuthClient });

      await expect(
        service.update(
          mockOAuthClient.tenantId,
          mockOAuthClient.clientId,
          {
            roles: ['superuser'],
          },
          platformAdminAuth,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should reject adding interactive grants to a client with roles', async () => {
      mockGetConfig.mockReturnValue({
        grantTypes: ['client_credentials', 'authorization_code'],
        scopes: CONFIGURED_SCOPES,
      });
      service = await createService();
      mockFindByTenantAndClientId.mockResolvedValue({
        ...mockOAuthClient,
        roles: ['platform-admin'],
        grantTypes: ['client_credentials'],
      });

      await expect(
        service.update(
          mockOAuthClient.tenantId,
          mockOAuthClient.clientId,
          {
            grantTypes: ['client_credentials', 'authorization_code'],
          },
          platformAdminAuth,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('rejects adding interactive grants to a privileged client even for a tenant-admin', async () => {
      mockGetConfig.mockReturnValue({
        grantTypes: ['client_credentials', 'authorization_code'],
        scopes: CONFIGURED_SCOPES,
      });
      service = await createService();
      mockFindByTenantAndClientId.mockResolvedValue({
        ...mockOAuthClient,
        roles: ['platform-admin'],
        grantTypes: ['client_credentials'],
      });

      await expect(
        service.update(
          mockOAuthClient.tenantId,
          mockOAuthClient.clientId,
          {
            grantTypes: ['client_credentials', 'authorization_code'],
          },
          tenantAdminAuth,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should reject adding roles to a non-machine client', async () => {
      mockGetConfig.mockReturnValue({
        grantTypes: ['client_credentials', 'authorization_code'],
        scopes: CONFIGURED_SCOPES,
      });
      service = await createService();
      mockFindByTenantAndClientId.mockResolvedValue({
        ...mockOAuthClient,
        roles: [],
        grantTypes: ['authorization_code'],
      });

      await expect(
        service.update(
          mockOAuthClient.tenantId,
          mockOAuthClient.clientId,
          {
            roles: ['platform-admin'],
          },
          platformAdminAuth,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should update redirectUris and grantTypes when provided', async () => {
      mockFindByTenantAndClientId.mockResolvedValue({ ...mockOAuthClient });
      const updatedClient = {
        ...mockOAuthClient,
        redirectUris: ['https://updated.example.com/callback'],
        grantTypes: ['client_credentials'],
      };
      mockUpdate.mockResolvedValue(updatedClient);

      const result = await service.update(
        mockOAuthClient.tenantId,
        mockOAuthClient.clientId,
        {
          redirectUris: ['https://updated.example.com/callback'],
          grantTypes: ['client_credentials'],
        },
        tenantAdminAuth,
      );

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
      mockFindByTenantAndClientId.mockResolvedValue({ ...mockOAuthClient });
      mockUpdate.mockImplementation((client: unknown) => client);

      await service.update(
        mockOAuthClient.tenantId,
        mockOAuthClient.clientId,
        {
          refreshTokenTtlSeconds: 3600,
        },
        tenantAdminAuth,
      );

      expect(mockUpdate.mock.calls[0][0].refreshTokenTtlSeconds).toBe(3600);
    });

    it('clears the TTL override when explicitly set to null', async () => {
      mockFindByTenantAndClientId.mockResolvedValue({
        ...mockOAuthClient,
        refreshTokenTtlSeconds: 3600,
      });
      mockUpdate.mockImplementation((client: unknown) => client);

      await service.update(
        mockOAuthClient.tenantId,
        mockOAuthClient.clientId,
        {
          refreshTokenTtlSeconds: null,
        },
        tenantAdminAuth,
      );

      expect(mockUpdate.mock.calls[0][0].refreshTokenTtlSeconds).toBeNull();
    });

    it('leaves the TTL untouched when the field is omitted', async () => {
      mockFindByTenantAndClientId.mockResolvedValue({
        ...mockOAuthClient,
        refreshTokenTtlSeconds: 3600,
      });
      mockUpdate.mockImplementation((client: unknown) => client);

      await service.update(
        mockOAuthClient.tenantId,
        mockOAuthClient.clientId,
        { name: 'Renamed' },
        tenantAdminAuth,
      );

      expect(mockUpdate.mock.calls[0][0].refreshTokenTtlSeconds).toBe(3600);
    });

    it('should preserve existing values when partial update is provided', async () => {
      mockFindByTenantAndClientId.mockResolvedValue({ ...mockOAuthClient });
      const updatedClient = {
        ...mockOAuthClient,
        name: 'Updated Name',
      };
      mockUpdate.mockResolvedValue(updatedClient);

      const result = await service.update(
        mockOAuthClient.tenantId,
        mockOAuthClient.clientId,
        {
          name: 'Updated Name',
        },
        tenantAdminAuth,
      );

      expect(result.name).toBe('Updated Name');
      expect(result.scopes).toEqual(mockOAuthClient.scopes);
      expect(result.redirectUris).toEqual(mockOAuthClient.redirectUris);
    });

    it('lets a clients:manage caller rename a client whose scopes they could not assign', async () => {
      mockFindByTenantAndClientId.mockResolvedValue({ ...mockOAuthClient });
      mockUpdate.mockImplementation((client: unknown) => client);

      const result = await service.update(
        mockOAuthClient.tenantId,
        mockOAuthClient.clientId,
        { name: 'Renamed by operator' },
        clientsManageAuth,
      );

      expect(result.name).toBe('Renamed by operator');
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('still rejects a clients:manage caller expanding scopes they do not hold', async () => {
      mockFindByTenantAndClientId.mockResolvedValue({
        ...mockOAuthClient,
        scopes: ['clients:manage'],
      });

      await expect(
        service.update(
          mockOAuthClient.tenantId,
          mockOAuthClient.clientId,
          { scopes: ['credentials:offer'] },
          clientsManageAuth,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('lets a tenant-admin rename a platform-admin machine client', async () => {
      mockFindByTenantAndClientId.mockResolvedValue({
        ...mockOAuthClient,
        roles: ['platform-admin'],
      });
      mockUpdate.mockImplementation((client: unknown) => client);

      const result = await service.update(
        mockOAuthClient.tenantId,
        mockOAuthClient.clientId,
        { name: 'Renamed privileged client' },
        tenantAdminAuth,
      );

      expect(result.name).toBe('Renamed privileged client');
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('still rejects a tenant-admin assigning roles', async () => {
      mockFindByTenantAndClientId.mockResolvedValue({ ...mockOAuthClient });

      await expect(
        service.update(
          mockOAuthClient.tenantId,
          mockOAuthClient.clientId,
          { roles: ['platform-admin'] },
          tenantAdminAuth,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if client not found', async () => {
      mockFindByTenantAndClientId.mockResolvedValue(null);

      await expect(
        service.update(
          mockOAuthClient.tenantId,
          'nonexistent',
          { name: 'Updated Name' },
          tenantAdminAuth,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject an unsupported grant type', async () => {
      await expect(
        service.update(
          mockOAuthClient.tenantId,
          mockOAuthClient.clientId,
          {
            grantTypes: ['authorization_code'],
          },
          tenantAdminAuth,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockFindByTenantAndClientId).not.toHaveBeenCalled();
    });
  });
});
