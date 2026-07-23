import { Test, TestingModule } from '@nestjs/testing';

import { CreateOAuthClientDto } from './dto/create-oauth-client.dto';
import { OAuthClientResponseDto } from './dto/oauth-client-response.dto';
import { UpdateOAuthClientDto } from './dto/update-oauth-client.dto';
import { OAuthClientController } from './oauth-client.controller';
import { OAuthClient } from './oauth-client.entity';
import { OAuthClientService } from './oauth-client.service';

describe('OAuthClientController', () => {
  let controller: OAuthClientController;

  let mockCreateClient: jest.Mock;
  let mockFindByClientId: jest.Mock;
  let mockFindByTenant: jest.Mock;
  let mockRevokeClient: jest.Mock;
  let mockUpdate: jest.Mock;

  const mockOAuthClient: OAuthClient = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    tenantId: '123e4567-e89b-12d3-a456-426614174001',
    clientId: 'client_abc123',
    clientSecretHash: 'hashed_secret',
    name: 'Test Client',
    scopes: ['read:credentials'],
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
    redirectUris: mockOAuthClient.redirectUris,
    grantTypes: mockOAuthClient.grantTypes,
    createdBy: mockOAuthClient.createdBy,
    createdAt: mockOAuthClient.createdAt,
    revokedAt: mockOAuthClient.revokedAt,
  };

  beforeEach(async () => {
    mockCreateClient = jest.fn();
    mockFindByClientId = jest.fn();
    mockFindByTenant = jest.fn();
    mockRevokeClient = jest.fn();
    mockUpdate = jest.fn();

    const mockService = {
      createClient: mockCreateClient,
      findByClientId: mockFindByClientId,
      findByTenant: mockFindByTenant,
      revokeClient: mockRevokeClient,
      update: mockUpdate,
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OAuthClientController],
      providers: [
        {
          provide: OAuthClientService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<OAuthClientController>(OAuthClientController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /oauth-clients', () => {
    it('should create a new OAuth client', async () => {
      const dto: CreateOAuthClientDto = {
        tenantId: mockOAuthClient.tenantId,
        name: mockOAuthClient.name,
        scopes: mockOAuthClient.scopes,
        redirectUris: mockOAuthClient.redirectUris,
        createdBy: mockOAuthClient.createdBy,
      };

      const result = {
        client: mockOAuthClient,
        clientSecret: 'secret_abc123',
      };

      mockCreateClient.mockResolvedValue(result);

      const response = await controller.createClient(dto);

      expect(mockCreateClient).toHaveBeenCalledWith(dto);
      expect(response).toEqual({
        client: mockResponseDto,
        clientSecret: 'secret_abc123',
      });
    });
  });

  describe('GET /oauth-clients/client/:clientId', () => {
    it('should find an OAuth client by client ID', async () => {
      mockFindByClientId.mockResolvedValue(mockOAuthClient);

      const result = await controller.findByClientId(mockOAuthClient.clientId);

      expect(mockFindByClientId).toHaveBeenCalledWith(mockOAuthClient.clientId);
      expect(result).toEqual(mockResponseDto);
    });
  });

  describe('GET /oauth-clients/tenant/:tenantId', () => {
    it('should find all OAuth clients for a tenant', async () => {
      mockFindByTenant.mockResolvedValue([mockOAuthClient]);

      const result = await controller.findByTenant(mockOAuthClient.tenantId);

      expect(mockFindByTenant).toHaveBeenCalledWith(mockOAuthClient.tenantId);
      expect(result).toEqual([mockResponseDto]);
    });
  });

  describe('DELETE /oauth-clients/:id/revoke', () => {
    it('should revoke an OAuth client', async () => {
      mockRevokeClient.mockResolvedValue(undefined);

      await controller.revokeClient(mockOAuthClient.id);

      expect(mockRevokeClient).toHaveBeenCalledWith(mockOAuthClient.id);
    });
  });

  describe('PATCH /oauth-clients/:id', () => {
    it('should update an OAuth client', async () => {
      const dto: UpdateOAuthClientDto = {
        name: 'Updated Client',
        scopes: ['read:credentials', 'write:credentials'],
      };

      const updatedClient: OAuthClient = {
        ...mockOAuthClient,
        ...dto,
      };

      mockUpdate.mockResolvedValue(updatedClient);

      const result = await controller.update(mockOAuthClient.id, dto);

      expect(mockUpdate).toHaveBeenCalledWith(mockOAuthClient.id, dto);
      expect(result.name).toBe('Updated Client');
      expect(result.scopes).toEqual(['read:credentials', 'write:credentials']);
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

      const result = await controller.update(mockOAuthClient.id, dto);

      expect(mockUpdate).toHaveBeenCalledWith(mockOAuthClient.id, dto);
      expect(result.name).toBe('New Name');
      expect(result.scopes).toEqual(mockOAuthClient.scopes);
    });
  });
});
