import type { Server } from 'node:http';

import { JwtGuard, ScopeGuard, TenantGuard, type AuthContext } from '@app/auth';
import { RequestContextService } from '@app/common/context/request-context.service';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { configureApp } from '../app.config';
import { OperationResponseDto } from '../operation/dto/operation-response.dto';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { Operation, OperationState } from '../operation/operation.entity';
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
  let app: INestApplication<Server>;

  let mockCreate: jest.Mock;
  let mockFindById: jest.Mock;
  let mockFindByTenantId: jest.Mock;
  let mockFindByTenantIdAndFilters: jest.Mock;
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

  const mockOperation: Operation = {
    id: '123e4567-e89b-12d3-a456-426614174003',
    tenantId: mockConnection.tenantId,
    type: OPERATION_TYPE.CONNECTION_CREATE,
    state: OperationState.COMPLETED,
    request: { method: 'POST', path: '/api/v1/connections', body: {} },
    result: {
      connection_id: mockConnection.id,
      invitation_url: 'https://traction.example.test/invite',
    },
    expiresAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    tenant: undefined as any,
  };

  beforeEach(async () => {
    mockCreate = jest.fn();
    mockFindById = jest.fn();
    mockFindByTenantId = jest.fn();
    mockFindByTenantIdAndFilters = jest.fn();
    mockDelete = jest.fn();

    const mockService = {
      create: mockCreate,
      findById: mockFindById,
      findByTenantId: mockFindByTenantId,
      findByTenantIdAndFilters: mockFindByTenantIdAndFilters,
      delete: mockDelete,
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConnectionController],
      providers: [
        ConfigService,
        RequestContextService,
        {
          provide: ConnectionService,
          useValue: mockService,
        },
      ],
    })
      .overrideGuard(JwtGuard)
      .useValue({
        canActivate: (context: ExecutionContext): boolean => {
          context.switchToHttp().getRequest<{ auth: AuthContext }>().auth =
            auth;
          return true;
        },
      })
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
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /connections', () => {
    it('documents the Connections namespace and optional connector_id selector', () => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      const path = '/api/v1/tenants/{tenantId}/connections';
      expect(document.paths[path]?.post?.tags).toEqual(['Connections']);
      expect(document.paths[path]?.get?.tags).toEqual(['Connections']);
      expect(document.paths[path]?.get?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'connector_id',
            in: 'query',
            schema: { type: 'string', format: 'uuid' },
          }),
        ]),
      );
      expect(document.paths[`${path}/{id}`]?.get?.tags).toEqual([
        'Connections',
      ]);
      expect(document.paths[`${path}/{id}`]?.delete?.tags).toEqual([
        'Connections',
      ]);
      expect(document.components?.schemas?.CreateConnectionDto).toMatchObject({
        properties: {
          connector_id: {
            oneOf: [
              { type: 'string', format: 'uuid' },
              { type: 'string', enum: ['default'] },
            ],
          },
        },
        required: ['protocol'],
      });
      expect(document.paths[path]?.post?.requestBody).toMatchObject({
        content: {
          'application/json': {
            examples: {
              create: { value: { connector_id: 'default' } },
              accept: { value: { connector_id: 'default' } },
              selectedConnector: {
                value: {
                  connector_id: '123e4567-e89b-12d3-a456-426614174002',
                },
              },
            },
          },
        },
      });
    });

    it.each([undefined, 'default', '123e4567-e89b-12d3-a456-426614174002'])(
      'accepts and transforms connector_id %s through the HTTP validation pipe',
      async (connectorId) => {
        mockCreate.mockResolvedValue(mockOperation);

        await request(app.getHttpServer())
          .post(`/api/v1/tenants/${mockConnection.tenantId}/connections`)
          .send({
            protocol: mockConnection.protocol,
            ...(connectorId === undefined ? {} : { connector_id: connectorId }),
          })
          .expect(201);

        expect(mockCreate).toHaveBeenCalledWith(
          mockConnection.tenantId,
          expect.objectContaining({
            protocol: mockConnection.protocol,
            connectorId,
          }),
          auth,
        );
      },
    );

    it.each(['', 'not-a-uuid', null, 42])(
      'rejects invalid connector_id %s before creating a connection',
      async (connectorId) => {
        await request(app.getHttpServer())
          .post(`/api/v1/tenants/${mockConnection.tenantId}/connections`)
          .send({
            protocol: mockConnection.protocol,
            connector_id: connectorId,
          })
          .expect(400);

        expect(mockCreate).not.toHaveBeenCalled();
      },
    );

    it('should create a connection and return the completed operation', async () => {
      const dto: CreateConnectionDto = {
        protocol: mockConnection.protocol,
        metadata: { ...mockConnection.metadata, alias: 'acme-partner' },
      };

      mockCreate.mockResolvedValue(mockOperation);

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
      expect(result).toEqual(OperationResponseDto.fromEntity(mockOperation));
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
    const connectorId = '123e4567-e89b-12d3-a456-426614174002';

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
        connectorId: undefined,
      });
      expect(result).toEqual({
        data: [ConnectionResponseDto.fromEntity(mockConnection)],
        pagination: { nextCursor: null, hasMore: false },
      });
    });

    it('should find connections by tenant id and state when state is provided', async () => {
      mockFindByTenantIdAndFilters.mockResolvedValue({
        data: [mockConnection],
        pagination: { next_cursor: null, has_more: false },
      });

      const result = await controller.findByTenantId(mockConnection.tenantId, {
        state: ConnectionState.ACTIVE,
      });

      expect(mockFindByTenantIdAndFilters).toHaveBeenCalledWith(
        mockConnection.tenantId,
        ConnectionState.ACTIVE,
        undefined,
        { limit: undefined, cursor: undefined, connectorId: undefined },
      );
      expect(result).toEqual({
        data: [ConnectionResponseDto.fromEntity(mockConnection)],
        pagination: { nextCursor: null, hasMore: false },
      });
    });

    it('passes state and protocol as direct params to findByTenantIdAndFilters', async () => {
      mockFindByTenantIdAndFilters.mockResolvedValue({
        data: [mockConnection],
        pagination: { next_cursor: null, has_more: false },
      });

      await controller.findByTenantId(mockConnection.tenantId, {
        state: ConnectionState.ACTIVE,
        protocol: ConnectionProtocol.DIDCOMM_V2,
      });

      expect(mockFindByTenantIdAndFilters).toHaveBeenCalledWith(
        mockConnection.tenantId,
        ConnectionState.ACTIVE,
        ConnectionProtocol.DIDCOMM_V2,
        { limit: undefined, cursor: undefined, connectorId: undefined },
      );
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
        connectorId: undefined,
      });
      expect(result.pagination).toEqual({
        nextCursor: 'opaque-cursor',
        hasMore: true,
      });
    });

    it('routes a protocol-only filter through findByTenantIdAndFilters with no state', async () => {
      mockFindByTenantIdAndFilters.mockResolvedValue({
        data: [],
        pagination: { next_cursor: null, has_more: false },
      });

      await controller.findByTenantId(mockConnection.tenantId, {
        protocol: ConnectionProtocol.DIDCOMM_V2,
      });

      expect(mockFindByTenantIdAndFilters).toHaveBeenCalledWith(
        mockConnection.tenantId,
        undefined,
        ConnectionProtocol.DIDCOMM_V2,
        { limit: undefined, cursor: undefined, connectorId: undefined },
      );
      expect(mockFindByTenantId).not.toHaveBeenCalled();
    });

    it('passes connector_id to the tenant-scoped service filter', async () => {
      mockFindByTenantId.mockResolvedValue({
        data: [],
        pagination: { next_cursor: null, has_more: false },
      });

      await request(app.getHttpServer())
        .get(`/api/v1/tenants/${mockConnection.tenantId}/connections`)
        .query({ connector_id: connectorId })
        .expect(200);

      expect(mockFindByTenantId).toHaveBeenCalledWith(mockConnection.tenantId, {
        limit: undefined,
        cursor: undefined,
        connectorId,
      });
    });

    it('rejects an invalid connector_id before querying connections', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/tenants/${mockConnection.tenantId}/connections`)
        .query({ connector_id: 'not-a-uuid' })
        .expect(400);

      expect(mockFindByTenantId).not.toHaveBeenCalled();
      expect(mockFindByTenantIdAndFilters).not.toHaveBeenCalled();
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
