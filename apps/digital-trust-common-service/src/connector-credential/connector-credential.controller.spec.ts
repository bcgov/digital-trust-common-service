import { JwtGuard, ScopeGuard, TenantGuard, type AuthContext } from '@app/auth';
import { CanActivate } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ConnectorType } from '../connection/connection.entity';
import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import { ConnectorCredentialController } from './connector-credential.controller';
import { ConnectorCredential } from './connector-credential.entity';
import { ConnectorCredentialService } from './connector-credential.service';
import { ConnectorCredentialResponseDto } from './dto/connector-credential-response.dto';
import { CreateConnectorCredentialDto } from './dto/create-connector-credential.dto';
import { UpdateConnectorCredentialDto } from './dto/update-connector-credential.dto';

class AllowGuard implements CanActivate {
  public canActivate(): boolean {
    return true;
  }
}

describe('ConnectorCredentialController', () => {
  let controller: ConnectorCredentialController;

  let mockCreate: jest.Mock;
  let mockFindById: jest.Mock;
  let mockFindByTenant: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockDelete: jest.Mock;
  let mockTestConnectivity: jest.Mock;

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

  const auth: AuthContext = {
    sub: 'user-1',
    tokenType: 'user',
    clientId: 'spa',
    tenantId: '123e4567-e89b-12d3-a456-426614174001',
    roles: [],
    scope: 'tenants:admin',
    scopes: ['tenants:admin'],
    iss: 'http://localhost/oidc',
    aud: 'http://localhost/oidc',
    exp: 9_999_999_999,
    iat: 1,
  };

  const mockResponseDto: ConnectorCredentialResponseDto = {
    id: mockCredential.id,
    tenantId: mockCredential.tenantId,
    connectorType: mockCredential.connectorType,
    endpointUrl: mockCredential.endpointUrl,
    active: mockCredential.active,
    createdAt: mockCredential.createdAt,
    updatedAt: mockCredential.updatedAt,
  };

  beforeEach(async () => {
    mockCreate = jest.fn();
    mockFindById = jest.fn();
    mockFindByTenant = jest.fn();
    mockUpdate = jest.fn();
    mockDelete = jest.fn();
    mockTestConnectivity = jest.fn();

    const mockService = {
      create: mockCreate,
      findById: mockFindById,
      findByTenant: mockFindByTenant,
      update: mockUpdate,
      delete: mockDelete,
      testConnectivity: mockTestConnectivity,
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConnectorCredentialController],
      providers: [
        {
          provide: ConnectorCredentialService,
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
      .overrideGuard(TenantStatusGuard)
      .useClass(AllowGuard)
      .overrideGuard(TenantTierRateLimitGuard)
      .useClass(AllowGuard)
      .compile();

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
        connectorType: mockCredential.connectorType,
        endpointUrl: mockCredential.endpointUrl,
        credentials: { apiKey: 'sk_live_abc123' },
      };

      mockCreate.mockResolvedValue(mockCredential);

      const result = await controller.create(
        mockCredential.tenantId,
        dto,
        auth,
      );

      expect(mockCreate).toHaveBeenCalledWith(
        mockCredential.tenantId,
        dto,
        auth,
      );
      expect(result).toEqual(mockResponseDto);
    });
  });

  describe('GET /connector-credentials/:id', () => {
    it('should find a credential by ID', async () => {
      mockFindById.mockResolvedValue(mockCredential);

      const result = await controller.findById(mockCredential.id, auth);

      expect(mockFindById).toHaveBeenCalledWith(mockCredential.id, auth);
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
  });

  describe('PATCH /connector-credentials/:id', () => {
    it('should update a connector credential', async () => {
      const updateDto: UpdateConnectorCredentialDto = {
        endpointUrl: 'https://traction.example.com/api/v2',
      };
      const updatedCredential = {
        ...mockCredential,
        endpointUrl: updateDto.endpointUrl,
      };
      const updatedResponseDto = {
        ...mockResponseDto,
        endpointUrl: updateDto.endpointUrl,
      };

      mockUpdate.mockResolvedValue(updatedCredential);

      const result = await controller.update(
        mockCredential.id,
        updateDto,
        auth,
      );

      expect(mockUpdate).toHaveBeenCalledWith(
        mockCredential.id,
        updateDto,
        auth,
      );
      expect(result).toEqual(updatedResponseDto);
    });
  });

  describe('DELETE /connector-credentials/:id', () => {
    it('should delete a connector credential', async () => {
      mockDelete.mockResolvedValue(undefined);

      await controller.delete(mockCredential.id, auth);

      expect(mockDelete).toHaveBeenCalledWith(mockCredential.id, auth);
    });
  });

  describe('POST /connector-credentials/:id/test', () => {
    it('should return the connectivity test result', async () => {
      const connectivityResult = { status: 'healthy', latencyMs: 42 };
      mockTestConnectivity.mockResolvedValue(connectivityResult);

      const result = await controller.test(mockCredential.id, auth);

      expect(mockTestConnectivity).toHaveBeenCalledWith(
        mockCredential.id,
        auth,
      );
      expect(result).toEqual(connectivityResult);
    });
  });
});
