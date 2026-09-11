import { JwtGuard, ScopeGuard, TenantGuard, type AuthContext } from '@app/auth';
import { CanActivate } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
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
  let mockFindByTenantId: jest.Mock;
  let mockFindByTenantIdAndState: jest.Mock;
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
    mockFindByTenantId = jest.fn();
    mockFindByTenantIdAndState = jest.fn();
    mockDelete = jest.fn();

    const mockService = {
      create: mockCreate,
      findById: mockFindById,
      findByTenantId: mockFindByTenantId,
      findByTenantIdAndState: mockFindByTenantIdAndState,
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
      .overrideGuard(TenantTierRateLimitGuard)
      .useClass(AllowGuard)
      .compile();

    controller = module.get<ConnectionController>(ConnectionController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /connections', () => {
    it('should create a connection and return the completed result', async () => {
      const dto: CreateConnectionDto = {
        protocol: mockConnection.protocol,
        alias: 'acme-partner',
        metadata: mockConnection.metadata,
      };

      mockCreate.mockResolvedValue(mockConnection);

      const result = await controller.create(
        mockConnection.tenantId,
        dto,
        auth,
      );

      expect(mockCreate).toHaveBeenCalledWith(
        mockConnection.tenantId,
        dto,
        auth,
      );
      expect(result).toEqual(ConnectionResponseDto.fromEntity(mockConnection));
    });
  });

  describe('GET /connections/:id', () => {
    it('should find a connection by id', async () => {
      mockFindById.mockResolvedValue(mockConnection);

      const result = await controller.findById(
        mockConnection.tenantId,
        mockConnection.id,
        auth,
      );

      expect(mockFindById).toHaveBeenCalledWith(
        mockConnection.tenantId,
        mockConnection.id,
        auth,
      );
      expect(result).toEqual(ConnectionResponseDto.fromEntity(mockConnection));
    });
  });

  describe('GET /connections/tenant/:tenantId', () => {
    it('should find connections by tenant id', async () => {
      mockFindByTenantId.mockResolvedValue({
        data: [mockConnection],
        pagination: { next_cursor: null, has_more: false },
      });

      const result = await controller.findByTenantId(
        mockConnection.tenantId,
        {},
      );

      expect(mockFindByTenantId).toHaveBeenCalledWith(mockConnection.tenantId, {
        limit: undefined,
        cursor: undefined,
      });
      expect(result).toEqual({
        data: [ConnectionResponseDto.fromEntity(mockConnection)],
        pagination: { nextCursor: null, hasMore: false },
      });
    });

    it('should find connections by tenant id and state when state is provided', async () => {
      mockFindByTenantIdAndState.mockResolvedValue({
        data: [mockConnection],
        pagination: { next_cursor: null, has_more: false },
      });

      const result = await controller.findByTenantId(mockConnection.tenantId, {
        state: ConnectionState.ACTIVE,
      });

      expect(mockFindByTenantIdAndState).toHaveBeenCalledWith(
        mockConnection.tenantId,
        ConnectionState.ACTIVE,
        { limit: undefined, cursor: undefined },
      );
      expect(result).toEqual({
        data: [ConnectionResponseDto.fromEntity(mockConnection)],
        pagination: { nextCursor: null, hasMore: false },
      });
    });

    it('passes cursor and limit through to the service', async () => {
      mockFindByTenantId.mockResolvedValue({
        data: [],
        pagination: { next_cursor: 'opaque-cursor', has_more: true },
      });

      const result = await controller.findByTenantId(mockConnection.tenantId, {
        cursor: 'previous-cursor',
        limit: 5,
      });

      expect(mockFindByTenantId).toHaveBeenCalledWith(mockConnection.tenantId, {
        limit: 5,
        cursor: 'previous-cursor',
      });
      expect(result.pagination).toEqual({
        nextCursor: 'opaque-cursor',
        hasMore: true,
      });
    });
  });

  describe('DELETE /connections/:id', () => {
    it('should delete a connection', async () => {
      mockDelete.mockResolvedValue(undefined);

      await controller.delete(mockConnection.tenantId, mockConnection.id, auth);

      expect(mockDelete).toHaveBeenCalledWith(
        mockConnection.tenantId,
        mockConnection.id,
        auth,
      );
    });
  });
});
