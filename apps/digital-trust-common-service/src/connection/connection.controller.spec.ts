import { JwtGuard, ScopeGuard, TenantGuard, type AuthContext } from '@app/auth';
import { CanActivate } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import { ConnectionController } from './connection.controller';
import {
  Connection,
  ConnectorType,
  ConnectionState,
  ConnectionProtocol,
} from './connection.entity';
import { ConnectionService } from './connection.service';
import { ConnectionResponseDto } from './dto/connection-response.dto';
import { CreateConnectionDto } from './dto/create-connection.dto';

class AllowGuard implements CanActivate {
  public canActivate(): boolean {
    return true;
  }
}

describe('ConnectionController', () => {
  let controller: ConnectionController;

  let mockCreate: jest.Mock;
  let mockFindById: jest.Mock;
  let mockFindByExternalConnectionId: jest.Mock;
  let mockFindByTenantId: jest.Mock;
  let mockFindByTenantIdAndState: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockDelete: jest.Mock;

  const mockConnection: Connection = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    tenantId: '123e4567-e89b-12d3-a456-426614174001',
    externalConnectionId: 'ext-conn-123',
    theirLabel: 'Alice',
    theirDid: 'did:example:123',
    state: ConnectionState.ACTIVE,
    connectorType: ConnectorType.TRACTION,
    protocol: ConnectionProtocol.DIDCOMM_V1,
    metadata: {},
    tenant: undefined as any,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const auth: AuthContext = {
    sub: 'user-1',
    tokenType: 'user',
    clientId: 'spa',
    tenantId: mockConnection.tenantId,
    roles: [],
    scope: 'connections:manage',
    scopes: ['connections:manage'],
    iss: 'http://localhost/oidc',
    aud: 'http://localhost/oidc',
    exp: 9_999_999_999,
    iat: 1,
  };

  beforeEach(async () => {
    mockCreate = jest.fn();
    mockFindById = jest.fn();
    mockFindByExternalConnectionId = jest.fn();
    mockFindByTenantId = jest.fn();
    mockFindByTenantIdAndState = jest.fn();
    mockUpdate = jest.fn();
    mockDelete = jest.fn();

    const mockService = {
      create: mockCreate,
      findById: mockFindById,
      findByExternalConnectionId: mockFindByExternalConnectionId,
      findByTenantId: mockFindByTenantId,
      findByTenantIdAndState: mockFindByTenantIdAndState,
      update: mockUpdate,
      delete: mockDelete,
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConnectionController],
      providers: [
        {
          provide: ConnectionService,
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
      .compile();

    controller = module.get<ConnectionController>(ConnectionController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /connections', () => {
    it('should create a new connection', async () => {
      const dto: CreateConnectionDto = {
        tenantId: mockConnection.tenantId,
        externalConnectionId: mockConnection.externalConnectionId,
        theirLabel: mockConnection.theirLabel,
        theirDid: mockConnection.theirDid,
        state: mockConnection.state,
        connectorType: mockConnection.connectorType,
        protocol: mockConnection.protocol,
        metadata: mockConnection.metadata,
      };

      mockCreate.mockResolvedValue(mockConnection);

      const result = await controller.create(dto, auth);

      expect(mockCreate).toHaveBeenCalledWith(dto, auth);
      expect(result).toEqual(ConnectionResponseDto.fromEntity(mockConnection));
    });
  });

  describe('GET /connections/:id', () => {
    it('should find a connection by id', async () => {
      mockFindById.mockResolvedValue(mockConnection);

      const result = await controller.findById(mockConnection.id, auth);

      expect(mockFindById).toHaveBeenCalledWith(mockConnection.id, auth);
      expect(result).toEqual(ConnectionResponseDto.fromEntity(mockConnection));
    });
  });

  describe('GET /connections/external/:externalConnectionId', () => {
    it('should find a connection by external connection id', async () => {
      mockFindByExternalConnectionId.mockResolvedValue(mockConnection);

      const result = await controller.findByExternalConnectionId(
        mockConnection.externalConnectionId,
        auth,
      );

      expect(mockFindByExternalConnectionId).toHaveBeenCalledWith(
        mockConnection.externalConnectionId,
        auth,
      );
      expect(result).toEqual(ConnectionResponseDto.fromEntity(mockConnection));
    });
  });

  describe('GET /connections/tenant/:tenantId', () => {
    it('should find connections by tenant id', async () => {
      mockFindByTenantId.mockResolvedValue([mockConnection]);

      const result = await controller.findByTenantId(mockConnection.tenantId);

      expect(mockFindByTenantId).toHaveBeenCalledWith(mockConnection.tenantId);
      expect(result).toEqual([
        ConnectionResponseDto.fromEntity(mockConnection),
      ]);
    });

    it('should find connections by tenant id and state when state is provided', async () => {
      mockFindByTenantIdAndState.mockResolvedValue([mockConnection]);

      const result = await controller.findByTenantId(
        mockConnection.tenantId,
        ConnectionState.ACTIVE,
      );

      expect(mockFindByTenantIdAndState).toHaveBeenCalledWith(
        mockConnection.tenantId,
        ConnectionState.ACTIVE,
      );
      expect(result).toEqual([
        ConnectionResponseDto.fromEntity(mockConnection),
      ]);
    });
  });

  describe('PATCH /connections/:id', () => {
    it('should update a connection', async () => {
      const dto: Partial<CreateConnectionDto> = {
        state: ConnectionState.COMPLETED,
      };

      mockUpdate.mockResolvedValue({ ...mockConnection, ...dto });

      const result = await controller.update(mockConnection.id, dto, auth);

      expect(mockUpdate).toHaveBeenCalledWith(mockConnection.id, dto, auth);
      expect(result.state).toEqual(ConnectionState.COMPLETED);
    });
  });

  describe('DELETE /connections/:id', () => {
    it('should delete a connection', async () => {
      mockDelete.mockResolvedValue(undefined);

      await controller.delete(mockConnection.id, auth);

      expect(mockDelete).toHaveBeenCalledWith(mockConnection.id, auth);
    });
  });
});
