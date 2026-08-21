import { JwtGuard, ScopeGuard, TenantGuard, type AuthContext } from '@app/auth';
import { CanActivate } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';

import { CreateOAuthClientDto } from './dto/create-oauth-client.dto';
import { OAuthClientResponseDto } from './dto/oauth-client-response.dto';
import { UpdateOAuthClientDto } from './dto/update-oauth-client.dto';
import { OAuthClientController } from './oauth-client.controller';
import { OAuthClient } from './oauth-client.entity';
import { OAuthClientService } from './oauth-client.service';

class AllowGuard implements CanActivate {
  public canActivate(): boolean {
    return true;
  }
}

describe('OAuthClientController', () => {
  let controller: OAuthClientController;

  let mockCreateClient: jest.Mock;
  let mockFindByTenant: jest.Mock;
  let mockRevokeClient: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockRotateSecret: jest.Mock;

  const mockOAuthClient: OAuthClient = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    tenantId: '123e4567-e89b-12d3-a456-426614174001',
    clientId: 'dtcs_abc123',
    clientSecretHash: 'hashed_secret',
    name: 'Test Client',
    scopes: ['credentials:offer'],
    roles: [],
    redirectUris: ['https://example.com/callback'],
    grantTypes: ['client_credentials'],
    createdBy: '123e4567-e89b-12d3-a456-426614174002',
    createdAt: new Date(),
    revokedAt: undefined,
    tenant: undefined as any,
  };

  const mockResponseDto: OAuthClientResponseDto = {
    id: mockOAuthClient.id,
    tenantId: mockOAuthClient.tenantId,
    clientId: mockOAuthClient.clientId,
    name: mockOAuthClient.name,
    scopes: mockOAuthClient.scopes,
    roles: mockOAuthClient.roles,
    redirectUris: mockOAuthClient.redirectUris,
    grantTypes: mockOAuthClient.grantTypes,
    refreshTokenTtlSeconds: mockOAuthClient.refreshTokenTtlSeconds ?? null,
    createdBy: mockOAuthClient.createdBy,
    createdAt: mockOAuthClient.createdAt,
    revokedAt: mockOAuthClient.revokedAt,
  };

  const auth: AuthContext = {
    sub: mockOAuthClient.createdBy as string,
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

  beforeEach(async () => {
    mockCreateClient = jest.fn();
    mockFindByTenant = jest.fn();
    mockRevokeClient = jest.fn();
    mockUpdate = jest.fn();
    mockRotateSecret = jest.fn();

    const mockService = {
      createClient: mockCreateClient,
      findByTenant: mockFindByTenant,
      revokeClient: mockRevokeClient,
      update: mockUpdate,
      rotateSecret: mockRotateSecret,
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OAuthClientController],
      providers: [
        {
          provide: OAuthClientService,
          useValue: mockService,
        },
      ],
    })
      .overrideGuard(JwtGuard)
      .useClass(AllowGuard)
      .overrideGuard(ScopeGuard)
      .useClass(AllowGuard)
      .overrideGuard(TenantGuard)
      .useClass(AllowGuard)
      .compile();

    controller = module.get<OAuthClientController>(OAuthClientController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('requires the clients:manage scope', () => {
    const scopes = new Reflector().get<string[]>(
      'required_scopes',
      OAuthClientController,
    );

    expect(scopes).toEqual(['clients:manage']);
  });

  describe('POST /tenants/:tenantId/clients', () => {
    it('should create a new OAuth client', async () => {
      const dto: CreateOAuthClientDto = {
        name: mockOAuthClient.name,
        scopes: mockOAuthClient.scopes,
        redirectUris: mockOAuthClient.redirectUris,
      };

      const result = {
        client: mockOAuthClient,
        clientSecret: 'secret_abc123',
      };

      mockCreateClient.mockResolvedValue(result);

      const response = await controller.createClient(
        mockOAuthClient.tenantId,
        dto,
        auth,
      );

      expect(mockCreateClient).toHaveBeenCalledWith(
        mockOAuthClient.tenantId,
        dto,
        auth,
      );
      expect(response).toEqual({
        client: mockResponseDto,
        clientSecret: 'secret_abc123',
      });
    });
  });

  describe('GET /tenants/:tenantId/clients', () => {
    it('should find all OAuth clients for a tenant', async () => {
      mockFindByTenant.mockResolvedValue([mockOAuthClient]);

      const result = await controller.findByTenant(mockOAuthClient.tenantId);

      expect(mockFindByTenant).toHaveBeenCalledWith(mockOAuthClient.tenantId);
      expect(result).toEqual([mockResponseDto]);
      expect(result[0]).not.toHaveProperty('clientSecret');
      expect(result[0]).not.toHaveProperty('clientSecretHash');
    });
  });

  describe('DELETE /tenants/:tenantId/clients/:clientId', () => {
    it('should revoke an OAuth client', async () => {
      mockRevokeClient.mockResolvedValue(undefined);

      await controller.revokeClient(
        mockOAuthClient.tenantId,
        mockOAuthClient.clientId,
      );

      expect(mockRevokeClient).toHaveBeenCalledWith(
        mockOAuthClient.tenantId,
        mockOAuthClient.clientId,
      );
    });
  });

  describe('POST /tenants/:tenantId/clients/:clientId/rotate-secret', () => {
    it('should rotate the client secret', async () => {
      mockRotateSecret.mockResolvedValue({
        client: mockOAuthClient,
        clientSecret: 'new_secret',
      });

      const result = await controller.rotateSecret(
        mockOAuthClient.tenantId,
        mockOAuthClient.clientId,
      );

      expect(mockRotateSecret).toHaveBeenCalledWith(
        mockOAuthClient.tenantId,
        mockOAuthClient.clientId,
      );
      expect(result).toEqual({
        client: mockResponseDto,
        clientSecret: 'new_secret',
      });
    });
  });

  describe('PATCH /tenants/:tenantId/clients/:clientId', () => {
    it('should update an OAuth client', async () => {
      const dto: UpdateOAuthClientDto = {
        name: 'Updated Client',
        scopes: ['credentials:offer', 'credentials:verify'],
      };

      const updatedClient: OAuthClient = {
        ...mockOAuthClient,
        ...dto,
      };

      mockUpdate.mockResolvedValue(updatedClient);

      const result = await controller.update(
        mockOAuthClient.tenantId,
        mockOAuthClient.clientId,
        dto,
        auth,
      );

      expect(mockUpdate).toHaveBeenCalledWith(
        mockOAuthClient.tenantId,
        mockOAuthClient.clientId,
        dto,
        auth,
      );
      expect(result.name).toBe('Updated Client');
      expect(result.scopes).toEqual([
        'credentials:offer',
        'credentials:verify',
      ]);
    });

    it('should update only specified fields', async () => {
      const dto: UpdateOAuthClientDto = {
        name: 'New Name',
      };

      const updatedClient: OAuthClient = {
        ...mockOAuthClient,
        name: 'New Name',
      };

      mockUpdate.mockResolvedValue(updatedClient);

      const result = await controller.update(
        mockOAuthClient.tenantId,
        mockOAuthClient.clientId,
        dto,
        auth,
      );

      expect(mockUpdate).toHaveBeenCalledWith(
        mockOAuthClient.tenantId,
        mockOAuthClient.clientId,
        dto,
        auth,
      );
      expect(result.name).toBe('New Name');
      expect(result.scopes).toEqual(mockOAuthClient.scopes);
    });
  });
});
