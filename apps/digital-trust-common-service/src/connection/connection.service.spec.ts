import { TenantAccessDeniedException } from '@app/auth';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { ConnectorCredential } from '../connector-credential/connector-credential.entity';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { Operation, OperationState } from '../operation/operation.entity';
import { OperationService } from '../operation/operation.service';

import {
  Connection,
  ConnectorType,
  ConnectionState,
  ConnectionProtocol,
} from './connection.entity';
import { ConnectionRepository } from './connection.repository';
import { ConnectionService } from './connection.service';
import { CreateConnectionDto } from './dto/create-connection.dto';

describe('ConnectionService', () => {
  let service: ConnectionService;
  let mockCreate: jest.Mock;
  let mockFindById: jest.Mock;
  let mockFindByExternalConnectionId: jest.Mock;
  let mockFindByTenantId: jest.Mock;
  let mockFindByTenantIdAndState: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockDelete: jest.Mock;
  let mockEmit: jest.Mock;
  let mockResolve: jest.Mock;
  let mockCreateOperation: jest.Mock;
  let mockTransitionState: jest.Mock;
  let mockCreateInvitation: jest.Mock;
  let mockGetById: jest.Mock;
  let mockList: jest.Mock;

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

  const mockConnector: ConnectorCredential = {
    id: '123e4567-e89b-12d3-a456-426614174002',
    tenantId: mockConnection.tenantId,
    connectorType: ConnectorType.TRACTION,
    credentialsEncrypted: Buffer.from('ciphertext'),
    endpointUrl: 'https://traction.example.test',
    active: true,
    keyVersion: 1,
    tenant: undefined as any,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockContext = {
    connectorId: mockConnector.id,
    tenantId: mockConnection.tenantId,
    endpointUrl: mockConnector.endpointUrl,
    credentials: { apiKey: 'secret' },
  };

  const mockOperation: Operation = {
    id: '123e4567-e89b-12d3-a456-426614174003',
    tenantId: mockConnection.tenantId,
    type: OPERATION_TYPE.CONNECTION_CREATE,
    state: OperationState.PENDING,
    request: { method: 'POST', path: '/api/v1/connections', body: {} },
    expiresAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    tenant: undefined as any,
  };

  const auth = {
    sub: 'user-1',
    tokenType: 'user' as const,
    clientId: 'spa',
    tenantId: mockConnection.tenantId,
    roles: [] as string[],
    scope: 'connections:manage',
    scopes: ['connections:manage'],
    iss: 'http://localhost/oidc',
    aud: 'http://localhost/oidc',
    exp: 9_999_999_999,
    iat: 1,
  };

  const mockAdapter = {
    createInvitation: undefined as unknown,
    getById: undefined as unknown,
    list: undefined as unknown,
  };

  beforeEach(async () => {
    mockCreate = jest.fn();
    mockFindById = jest.fn();
    mockFindByExternalConnectionId = jest.fn();
    mockFindByTenantId = jest.fn();
    mockFindByTenantIdAndState = jest.fn();
    mockUpdate = jest.fn();
    mockDelete = jest.fn();
    mockEmit = jest.fn().mockResolvedValue(undefined);
    mockResolve = jest.fn();
    mockCreateOperation = jest.fn();
    mockTransitionState = jest.fn();
    mockCreateInvitation = jest.fn();
    mockGetById = jest.fn();
    mockList = jest.fn();

    mockAdapter.createInvitation = mockCreateInvitation;
    mockAdapter.getById = mockGetById;
    mockAdapter.list = mockList;

    const mockRepository = {
      create: mockCreate,
      findById: mockFindById,
      findByExternalConnectionId: mockFindByExternalConnectionId,
      findByTenantId: mockFindByTenantId,
      findByTenantIdAndState: mockFindByTenantIdAndState,
      update: mockUpdate,
      delete: mockDelete,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectionService,
        {
          provide: ConnectionRepository,
          useValue: mockRepository,
        },
        {
          provide: DomainAuditService,
          useValue: { emit: mockEmit },
        },
        {
          provide: AdapterRegistry,
          useValue: { resolve: mockResolve },
        },
        {
          provide: OperationService,
          useValue: {
            createOperation: mockCreateOperation,
            transitionState: mockTransitionState,
          },
        },
      ],
    }).compile();

    service = module.get<ConnectionService>(ConnectionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const dto: CreateConnectionDto = {
      protocol: mockConnection.protocol,
      alias: 'acme-partner',
      label: 'Acme Corp',
      metadata: { key: 'value' },
    };

    beforeEach(() => {
      mockResolve.mockResolvedValue({
        adapter: mockAdapter,
        connector: mockConnector,
        context: mockContext,
        format: undefined,
      });
      mockCreate.mockResolvedValue(mockConnection);
      mockCreateOperation.mockResolvedValue(mockOperation);
      mockFindById.mockResolvedValue({ ...mockConnection });
      mockUpdate.mockImplementation((connection) =>
        Promise.resolve(connection),
      );
    });

    it('resolves the connector, creates the connection invited, calls the adapter inline, and returns the completed connection', async () => {
      mockCreateInvitation.mockResolvedValue({
        invitationId: 'invi-msg-1',
        invitationUrl: 'https://traction.example.test/invite',
        connectionId: 'traction-conn-1',
      });

      const result = await service.create(mockConnection.tenantId, dto, auth);

      expect(mockResolve).toHaveBeenCalledWith(mockConnection.tenantId);
      expect(mockCreate).toHaveBeenCalledWith({
        tenantId: mockConnection.tenantId,
        connectorType: mockConnector.connectorType,
        protocol: dto.protocol,
        state: ConnectionState.INVITED,
        metadata: dto.metadata,
      });
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: mockConnection.tenantId,
        action: AuditAction.CREATE,
        resourceType: 'connection',
        resourceId: mockConnection.id,
      });
      expect(mockCreateOperation).toHaveBeenCalledWith({
        tenantId: mockConnection.tenantId,
        type: OPERATION_TYPE.CONNECTION_CREATE,
        request: {
          method: 'POST',
          path: `/api/v1/tenants/${mockConnection.tenantId}/connections`,
          body: dto,
        },
      });
      expect(mockTransitionState).toHaveBeenNthCalledWith(
        1,
        mockOperation.id,
        OperationState.PROCESSING,
      );
      expect(mockCreateInvitation).toHaveBeenCalledWith(mockContext, {
        alias: dto.alias,
        label: dto.label,
        goalCode: dto.goalCode,
        multiUse: dto.multiUse,
      });
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          externalConnectionId: 'traction-conn-1',
          metadata: expect.objectContaining({
            invitationUrl: 'https://traction.example.test/invite',
            invitationId: 'invi-msg-1',
          }),
        }),
      );
      expect(mockTransitionState).toHaveBeenNthCalledWith(
        2,
        mockOperation.id,
        OperationState.COMPLETED,
        {
          connectionId: mockConnection.id,
          externalConnectionId: 'invi-msg-1',
          invitationUrl: 'https://traction.example.test/invite',
        },
      );
      expect(result).toEqual(
        expect.objectContaining({ externalConnectionId: 'traction-conn-1' }),
      );
    });

    it('rejects create when the path tenant does not match the token', async () => {
      await expect(
        service.create('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', dto, auth),
      ).rejects.toThrow(TenantAccessDeniedException);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('marks the connection abandoned and the operation failed when the adapter call fails', async () => {
      const error = new Error('connector unavailable');
      mockCreateInvitation.mockRejectedValue(error);

      await expect(
        service.create(mockConnection.tenantId, dto, auth),
      ).rejects.toThrow(error);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ state: ConnectionState.ABANDONED }),
      );
      expect(mockTransitionState).toHaveBeenNthCalledWith(
        2,
        mockOperation.id,
        OperationState.FAILED,
        expect.objectContaining({ code: 'CONNECTION_CREATE_FAILED' }),
      );
    });

    it('throws NotFoundException if the connection row disappeared before the invitation result could be applied', async () => {
      mockCreateInvitation.mockResolvedValue({
        invitationId: 'traction-conn-1',
        invitationUrl: 'https://traction.example.test/invite',
      });
      mockFindById.mockResolvedValue(null);

      await expect(
        service.create(mockConnection.tenantId, dto, auth),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findById', () => {
    beforeEach(() => {
      mockResolve.mockResolvedValue({
        adapter: mockAdapter,
        connector: mockConnector,
        context: mockContext,
        format: undefined,
      });
      mockUpdate.mockImplementation((connection) =>
        Promise.resolve(connection),
      );
    });

    it('should throw NotFoundException if connection not found', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(
        service.findById(mockConnection.tenantId, mockConnection.id, auth),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns NotFoundException when the path tenant does not match the connection', async () => {
      mockFindById.mockResolvedValue(mockConnection);

      await expect(
        service.findById(
          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          mockConnection.id,
          auth,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns NotFoundException for cross-tenant resource access', async () => {
      mockFindById.mockResolvedValue(mockConnection);

      await expect(
        service.findById(mockConnection.tenantId, mockConnection.id, {
          ...auth,
          tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns the persisted connection unchanged when there is no external connection id yet', async () => {
      const invited = { ...mockConnection, externalConnectionId: undefined };
      mockFindById.mockResolvedValue(invited);

      const result = await service.findById(
        mockConnection.tenantId,
        invited.id,
        auth,
      );

      expect(mockResolve).not.toHaveBeenCalled();
      expect(result).toEqual(invited);
    });

    it('syncs the connection state and their-label from the connector', async () => {
      mockFindById.mockResolvedValue({ ...mockConnection });
      mockGetById.mockResolvedValue({
        id: mockConnection.externalConnectionId,
        state: 'completed',
        theirLabel: 'Bob',
        createdAt: mockConnection.createdAt.toISOString(),
        updatedAt: mockConnection.updatedAt.toISOString(),
      });

      const result = await service.findById(
        mockConnection.tenantId,
        mockConnection.id,
        auth,
      );

      expect(mockResolve).toHaveBeenCalledWith(mockConnection.tenantId);
      expect(mockGetById).toHaveBeenCalledWith(
        mockContext,
        mockConnection.externalConnectionId,
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          state: ConnectionState.COMPLETED,
          theirLabel: 'Bob',
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          state: ConnectionState.COMPLETED,
          theirLabel: 'Bob',
        }),
      );
    });

    it('skips the repository update when the connector reports no change', async () => {
      mockFindById.mockResolvedValue({ ...mockConnection });
      mockGetById.mockResolvedValue({
        id: mockConnection.externalConnectionId,
        state: 'active',
        theirLabel: mockConnection.theirLabel,
        createdAt: mockConnection.createdAt.toISOString(),
        updatedAt: mockConnection.updatedAt.toISOString(),
      });

      const result = await service.findById(
        mockConnection.tenantId,
        mockConnection.id,
        auth,
      );

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(result).toEqual(mockConnection);
    });

    it('returns the persisted connection when the connector cannot be reached', async () => {
      mockFindById.mockResolvedValue({ ...mockConnection });
      mockGetById.mockRejectedValue(new Error('connector unavailable'));

      const result = await service.findById(
        mockConnection.tenantId,
        mockConnection.id,
        auth,
      );

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(result).toEqual(mockConnection);
    });
  });

  describe('findByTenantId', () => {
    beforeEach(() => {
      mockResolve.mockResolvedValue({
        adapter: mockAdapter,
        connector: mockConnector,
        context: mockContext,
        format: undefined,
      });
      mockUpdate.mockImplementation((connection) =>
        Promise.resolve(connection),
      );
    });

    it('syncs every connection with a single list() call to the connector', async () => {
      mockFindByTenantId.mockResolvedValue([{ ...mockConnection }]);
      mockList.mockResolvedValue([
        {
          id: mockConnection.externalConnectionId,
          state: 'completed',
          theirLabel: 'Bob',
          createdAt: mockConnection.createdAt.toISOString(),
          updatedAt: mockConnection.updatedAt.toISOString(),
        },
      ]);

      const result = await service.findByTenantId(mockConnection.tenantId);

      expect(mockFindByTenantId).toHaveBeenCalledWith(mockConnection.tenantId);
      expect(mockResolve).toHaveBeenCalledWith(mockConnection.tenantId);
      expect(mockList).toHaveBeenCalledWith(mockContext, {});
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          state: ConnectionState.COMPLETED,
          theirLabel: 'Bob',
        }),
      );
      expect(result).toEqual({
        data: [
          expect.objectContaining({
            state: ConnectionState.COMPLETED,
            theirLabel: 'Bob',
          }),
        ],
        pagination: { next_cursor: null, has_more: false },
      });
    });

    it('leaves a connection unchanged when the connector list does not report it', async () => {
      mockFindByTenantId.mockResolvedValue([{ ...mockConnection }]);
      mockList.mockResolvedValue([]);

      const result = await service.findByTenantId(mockConnection.tenantId);

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
      expect(result).toEqual({
        data: [mockConnection],
        pagination: { next_cursor: null, has_more: false },
      });
    });

    it('links a pending connection to its connector record by invitationId once assigned, instead of importing a duplicate', async () => {
      const pending = {
        ...mockConnection,
        externalConnectionId: null,
        state: ConnectionState.INVITED,
        theirLabel: undefined,
        metadata: { invitationId: 'invi-msg-1' },
      };
      mockFindByTenantId.mockResolvedValue([pending]);
      mockList.mockResolvedValue([
        {
          id: 'traction-conn-1',
          state: 'active',
          theirLabel: 'Bob',
          invitationId: 'invi-msg-1',
          createdAt: mockConnection.createdAt.toISOString(),
          updatedAt: mockConnection.updatedAt.toISOString(),
        },
      ]);

      const result = await service.findByTenantId(mockConnection.tenantId);

      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          externalConnectionId: 'traction-conn-1',
          state: ConnectionState.ACTIVE,
          theirLabel: 'Bob',
        }),
      );
      expect(result).toEqual({
        data: [
          expect.objectContaining({
            externalConnectionId: 'traction-conn-1',
            state: ConnectionState.ACTIVE,
            theirLabel: 'Bob',
          }),
        ],
        pagination: { next_cursor: null, has_more: false },
      });
    });

    it('imports a connector-side connection that has no local row yet', async () => {
      mockFindByTenantId.mockResolvedValue([]);
      mockList.mockResolvedValue([
        {
          id: 'traction-conn-new',
          state: 'active',
          theirLabel: 'Carol',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]);
      mockCreate.mockImplementation((connection) =>
        Promise.resolve({ ...mockConnection, ...connection, id: 'new-id' }),
      );

      const result = await service.findByTenantId(mockConnection.tenantId);

      expect(mockCreate).toHaveBeenCalledWith({
        tenantId: mockConnection.tenantId,
        connectorType: mockConnector.connectorType,
        protocol: ConnectionProtocol.DIDCOMM_V1,
        state: ConnectionState.ACTIVE,
        theirLabel: 'Carol',
        externalConnectionId: 'traction-conn-new',
        metadata: {},
      });
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: mockConnection.tenantId,
        action: AuditAction.CREATE,
        resourceType: 'connection',
        resourceId: 'new-id',
      });
      expect(result).toEqual({
        data: [
          expect.objectContaining({
            id: 'new-id',
            externalConnectionId: 'traction-conn-new',
            theirLabel: 'Carol',
          }),
        ],
        pagination: { next_cursor: null, has_more: false },
      });
    });

    it('falls back to the existing row when a concurrent call already imported it', async () => {
      mockFindByTenantId.mockResolvedValue([]);
      mockList.mockResolvedValue([
        {
          id: 'traction-conn-new',
          state: 'active',
          theirLabel: 'Carol',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]);
      mockCreate.mockRejectedValue(new Error('duplicate key value'));
      const raceWinner = {
        ...mockConnection,
        id: 'raced-id',
        externalConnectionId: 'traction-conn-new',
      };
      mockFindByExternalConnectionId.mockResolvedValue(raceWinner);

      const result = await service.findByTenantId(mockConnection.tenantId);

      expect(mockFindByExternalConnectionId).toHaveBeenCalledWith(
        'traction-conn-new',
      );
      expect(mockEmit).not.toHaveBeenCalled();
      expect(result).toEqual({
        data: [raceWinner],
        pagination: { next_cursor: null, has_more: false },
      });
    });

    it('propagates the create failure when no row was imported concurrently', async () => {
      mockFindByTenantId.mockResolvedValue([]);
      mockList.mockResolvedValue([
        {
          id: 'traction-conn-new',
          state: 'active',
          theirLabel: 'Carol',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]);
      const error = new Error('constraint violation');
      mockCreate.mockRejectedValue(error);
      mockFindByExternalConnectionId.mockResolvedValue(null);

      await expect(
        service.findByTenantId(mockConnection.tenantId),
      ).rejects.toThrow(error);
    });

    it('returns the persisted connections when the connector cannot be reached', async () => {
      mockFindByTenantId.mockResolvedValue([{ ...mockConnection }]);
      mockList.mockRejectedValue(new Error('connector unavailable'));

      const result = await service.findByTenantId(mockConnection.tenantId);

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(result).toEqual({
        data: [mockConnection],
        pagination: { next_cursor: null, has_more: false },
      });
    });

    it('paginates the reconciled list and returns an opaque next_cursor', async () => {
      const older = {
        ...mockConnection,
        id: 'conn-older',
        externalConnectionId: 'ext-older',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      };
      const newer = {
        ...mockConnection,
        id: 'conn-newer',
        externalConnectionId: 'ext-newer',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      };
      mockFindByTenantId.mockResolvedValue([older, newer]);
      mockList.mockResolvedValue([]);

      const result = await service.findByTenantId(mockConnection.tenantId, {
        limit: 1,
      });

      expect(result.data).toEqual([older]);
      expect(result.pagination.has_more).toBe(true);
      expect(typeof result.pagination.next_cursor).toBe('string');

      const nextPage = await service.findByTenantId(mockConnection.tenantId, {
        limit: 1,
        cursor: result.pagination.next_cursor ?? undefined,
      });

      expect(nextPage.data).toEqual([newer]);
      expect(nextPage.pagination).toEqual({
        next_cursor: null,
        has_more: false,
      });
    });

    it('rejects a malformed pagination cursor', async () => {
      mockFindByTenantId.mockResolvedValue([{ ...mockConnection }]);
      mockList.mockResolvedValue([]);

      await expect(
        service.findByTenantId(mockConnection.tenantId, {
          cursor: 'not-a-valid-cursor',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findByTenantIdAndState', () => {
    it('should find connections by tenant id and state', async () => {
      mockFindByTenantIdAndState.mockResolvedValue([mockConnection]);

      const result = await service.findByTenantIdAndState(
        mockConnection.tenantId,
        mockConnection.state,
      );

      expect(mockFindByTenantIdAndState).toHaveBeenCalledWith(
        mockConnection.tenantId,
        mockConnection.state,
      );
      expect(result).toEqual({
        data: [mockConnection],
        pagination: { next_cursor: null, has_more: false },
      });
    });
  });

  describe('delete', () => {
    it('should delete a connection', async () => {
      mockFindById.mockResolvedValue(mockConnection);

      await service.delete(mockConnection.tenantId, mockConnection.id, auth);

      expect(mockFindById).toHaveBeenCalledWith(mockConnection.id);
      expect(mockDelete).toHaveBeenCalledWith(mockConnection.id);
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: mockConnection.tenantId,
        action: AuditAction.DELETE,
        resourceType: 'connection',
        resourceId: mockConnection.id,
      });
    });

    it('should throw NotFoundException if connection not found on delete', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(
        service.delete(mockConnection.tenantId, mockConnection.id, auth),
      ).rejects.toThrow(NotFoundException);
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });
});
