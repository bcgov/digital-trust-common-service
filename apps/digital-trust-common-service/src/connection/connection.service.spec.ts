import { TenantAccessDeniedException } from '@app/auth';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { encodeCursor } from '../common/cursor-pagination';
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
  let mockFindPageForTenant: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockUpdateStateIfForward: jest.Mock;
  let mockDelete: jest.Mock;
  let mockEmit: jest.Mock;
  let mockResolve: jest.Mock;
  let mockCreateOperation: jest.Mock;
  let mockTransitionState: jest.Mock;
  let mockCreateInvitation: jest.Mock;
  let mockAcceptInvitation: jest.Mock;
  let mockGetById: jest.Mock;
  let mockList: jest.Mock;
  let mockDeleteById: jest.Mock;

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
    acceptInvitation: undefined as unknown,
    getById: undefined as unknown,
    list: undefined as unknown,
    deleteById: undefined as unknown,
  };

  beforeEach(async () => {
    mockCreate = jest.fn();
    mockFindById = jest.fn();
    mockFindByExternalConnectionId = jest.fn();
    mockFindPageForTenant = jest.fn();
    mockUpdate = jest.fn();
    mockUpdateStateIfForward = jest.fn();
    mockDelete = jest.fn();
    mockEmit = jest.fn().mockResolvedValue(undefined);
    mockResolve = jest.fn();
    mockCreateOperation = jest.fn();
    mockTransitionState = jest.fn();
    mockCreateInvitation = jest.fn();
    mockAcceptInvitation = jest.fn();
    mockGetById = jest.fn();
    mockList = jest.fn();
    mockDeleteById = jest.fn();

    mockAdapter.createInvitation = mockCreateInvitation;
    mockAdapter.acceptInvitation = mockAcceptInvitation;
    mockAdapter.getById = mockGetById;
    mockAdapter.list = mockList;
    mockAdapter.deleteById = mockDeleteById;

    const mockRepository = {
      create: mockCreate,
      findById: mockFindById,
      findByExternalConnectionId: mockFindByExternalConnectionId,
      findPageForTenant: mockFindPageForTenant,
      update: mockUpdate,
      updateStateIfForward: mockUpdateStateIfForward,
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
      mockTransitionState.mockImplementation((id, state, result) =>
        Promise.resolve({
          ...mockOperation,
          state,
          result: result ?? null,
        }),
      );
    });

    it('resolves the connector, creates the connection invited, calls the adapter inline, and returns the completed operation', async () => {
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
            multiUse: false,
          }),
        }),
      );
      expect(mockTransitionState).toHaveBeenNthCalledWith(
        2,
        mockOperation.id,
        OperationState.COMPLETED,
        {
          connection_id: mockConnection.id,
          invitation_url: 'https://traction.example.test/invite',
        },
      );
      expect(result).toEqual(
        expect.objectContaining({ state: OperationState.COMPLETED }),
      );
    });

    it('strips reserved correlation keys from caller-supplied metadata before persisting', async () => {
      const maliciousDto: CreateConnectionDto = {
        ...dto,
        metadata: {
          key: 'value',
          invitationId: 'attacker-invi-1',
          invitationUrl: 'https://attacker.example.test/invite',
          multiUse: true,
        },
      };
      mockCreateInvitation.mockResolvedValue({
        invitationId: 'invi-msg-1',
        invitationUrl: 'https://traction.example.test/invite',
        connectionId: 'traction-conn-1',
      });

      await service.create(mockConnection.tenantId, maliciousDto, auth);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { key: 'value' } }),
      );
    });

    it('accepts an invitation, adopts the remote connection state, and returns the completed operation', async () => {
      const acceptDto: CreateConnectionDto = {
        protocol: mockConnection.protocol,
        invitationUrl: 'https://example.com/invitations/abc123',
      };
      const remote = {
        id: 'traction-conn-2',
        state: 'active',
        theirLabel: 'Bob',
        createdAt: mockConnection.createdAt.toISOString(),
        updatedAt: mockConnection.updatedAt.toISOString(),
      };
      mockAcceptInvitation.mockResolvedValue(remote);

      const result = await service.create(
        mockConnection.tenantId,
        acceptDto,
        auth,
      );

      expect(mockCreate).toHaveBeenCalledWith({
        tenantId: mockConnection.tenantId,
        connectorType: mockConnector.connectorType,
        protocol: acceptDto.protocol,
        state: ConnectionState.REQUESTED,
        metadata: {},
      });
      expect(mockCreateInvitation).not.toHaveBeenCalled();
      expect(mockAcceptInvitation).toHaveBeenCalledWith(
        mockContext,
        acceptDto.invitationUrl,
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          state: ConnectionState.ACTIVE,
          theirLabel: 'Bob',
          externalConnectionId: 'traction-conn-2',
        }),
      );
      expect(mockTransitionState).toHaveBeenNthCalledWith(
        2,
        mockOperation.id,
        OperationState.COMPLETED,
        {
          connection_id: mockConnection.id,
          state: ConnectionState.ACTIVE,
        },
      );
      expect(result).toEqual(
        expect.objectContaining({ state: OperationState.COMPLETED }),
      );
    });

    it('rejects create when the path tenant does not match the token', async () => {
      await expect(
        service.create('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', dto, auth),
      ).rejects.toThrow(TenantAccessDeniedException);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('marks the connection abandoned and returns the failed operation when the adapter call fails', async () => {
      const error = new Error('connector unavailable');
      mockCreateInvitation.mockRejectedValue(error);

      const result = await service.create(mockConnection.tenantId, dto, auth);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ state: ConnectionState.ABANDONED }),
      );
      expect(mockTransitionState).toHaveBeenNthCalledWith(
        2,
        mockOperation.id,
        OperationState.FAILED,
        expect.objectContaining({
          code: 'CONNECTION_CREATE_FAILED',
          message: error.message,
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({ state: OperationState.FAILED }),
      );
    });

    it('returns the failed operation if the connection row disappeared before the invitation result could be applied', async () => {
      mockCreateInvitation.mockResolvedValue({
        invitationId: 'traction-conn-1',
        invitationUrl: 'https://traction.example.test/invite',
      });
      mockFindById.mockResolvedValue(null);

      const result = await service.create(mockConnection.tenantId, dto, auth);

      expect(mockTransitionState).toHaveBeenNthCalledWith(
        2,
        mockOperation.id,
        OperationState.FAILED,
        expect.objectContaining({ code: 'CONNECTION_CREATE_FAILED' }),
      );
      expect(result).toEqual(
        expect.objectContaining({ state: OperationState.FAILED }),
      );
    });
  });

  describe('findById', () => {
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

    it('returns the persisted connection as-is, without contacting the connector', async () => {
      mockFindById.mockResolvedValue({ ...mockConnection });

      const result = await service.findById(
        mockConnection.tenantId,
        mockConnection.id,
        auth,
      );

      expect(mockResolve).not.toHaveBeenCalled();
      expect(mockGetById).not.toHaveBeenCalled();
      expect(result).toEqual(mockConnection);
    });
  });

  describe('findByTenantId', () => {
    it('returns the persisted connections for the tenant, without contacting the connector', async () => {
      mockFindPageForTenant.mockResolvedValue({
        items: [{ ...mockConnection }],
        nextCursor: null,
        hasMore: false,
      });

      const result = await service.findByTenantId(mockConnection.tenantId);

      expect(mockFindPageForTenant).toHaveBeenCalledWith(
        mockConnection.tenantId,
        { limit: 20, cursor: null, state: undefined, protocol: undefined },
      );
      expect(mockResolve).not.toHaveBeenCalled();
      expect(mockList).not.toHaveBeenCalled();
      expect(result).toEqual({
        data: [mockConnection],
        pagination: { next_cursor: null, has_more: false },
      });
    });

    it('passes the decoded cursor and limit to the repository and encodes its next cursor', async () => {
      const nextCursor = {
        createdAt: mockConnection.createdAt.toISOString(),
        id: mockConnection.id,
      };
      mockFindPageForTenant.mockResolvedValue({
        items: [mockConnection],
        nextCursor,
        hasMore: true,
      });

      const result = await service.findByTenantId(mockConnection.tenantId, {
        limit: 1,
      });

      expect(mockFindPageForTenant).toHaveBeenCalledWith(
        mockConnection.tenantId,
        { limit: 1, cursor: null, state: undefined, protocol: undefined },
      );
      expect(result.pagination.has_more).toBe(true);
      expect(result.pagination.next_cursor).toEqual(encodeCursor(nextCursor));
    });

    it('decodes a provided cursor and passes it to the repository', async () => {
      const cursor = {
        createdAt: mockConnection.createdAt.toISOString(),
        id: mockConnection.id,
      };
      const encoded = encodeCursor(cursor);
      mockFindPageForTenant.mockResolvedValue({
        items: [],
        nextCursor: null,
        hasMore: false,
      });

      await service.findByTenantId(mockConnection.tenantId, {
        cursor: encoded,
      });

      expect(mockFindPageForTenant).toHaveBeenCalledWith(
        mockConnection.tenantId,
        { limit: 20, cursor, state: undefined, protocol: undefined },
      );
    });

    it('rejects a malformed pagination cursor without contacting the repository', async () => {
      await expect(
        service.findByTenantId(mockConnection.tenantId, {
          cursor: 'not-a-valid-cursor',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockFindPageForTenant).not.toHaveBeenCalled();
    });
  });

  describe('findByTenantIdAndFilters', () => {
    it('finds connections by tenant id and state, without contacting the connector', async () => {
      mockFindPageForTenant.mockResolvedValue({
        items: [mockConnection],
        nextCursor: null,
        hasMore: false,
      });

      const result = await service.findByTenantIdAndFilters(
        mockConnection.tenantId,
        mockConnection.state,
      );

      expect(mockFindPageForTenant).toHaveBeenCalledWith(
        mockConnection.tenantId,
        {
          limit: 20,
          cursor: null,
          state: mockConnection.state,
          protocol: undefined,
        },
      );
      expect(mockResolve).not.toHaveBeenCalled();
      expect(mockList).not.toHaveBeenCalled();
      expect(result).toEqual({
        data: [mockConnection],
        pagination: { next_cursor: null, has_more: false },
      });
    });

    it('passes the protocol filter as a direct parameter, not a nested option', async () => {
      mockFindPageForTenant.mockResolvedValue({
        items: [mockConnection],
        nextCursor: null,
        hasMore: false,
      });

      await service.findByTenantIdAndFilters(
        mockConnection.tenantId,
        mockConnection.state,
        mockConnection.protocol,
        { limit: 5 },
      );

      expect(mockFindPageForTenant).toHaveBeenCalledWith(
        mockConnection.tenantId,
        {
          limit: 5,
          cursor: null,
          state: mockConnection.state,
          protocol: mockConnection.protocol,
        },
      );
    });

    it('filters by protocol alone, with no state given', async () => {
      mockFindPageForTenant.mockResolvedValue({
        items: [mockConnection],
        nextCursor: null,
        hasMore: false,
      });

      await service.findByTenantIdAndFilters(
        mockConnection.tenantId,
        undefined,
        mockConnection.protocol,
      );

      expect(mockFindPageForTenant).toHaveBeenCalledWith(
        mockConnection.tenantId,
        {
          limit: 20,
          cursor: null,
          state: undefined,
          protocol: mockConnection.protocol,
        },
      );
    });
  });

  describe('delete', () => {
    it('should delete a connection on the connector when it has an external connection id', async () => {
      mockFindById.mockResolvedValue(mockConnection);
      mockResolve.mockResolvedValue({
        adapter: mockAdapter,
        connector: mockConnector,
        context: mockContext,
        format: undefined,
      });

      await service.delete(mockConnection.tenantId, mockConnection.id, auth);

      expect(mockFindById).toHaveBeenCalledWith(mockConnection.id);
      expect(mockResolve).toHaveBeenCalledWith(mockConnection.tenantId);
      expect(mockDeleteById).toHaveBeenCalledWith(
        mockContext,
        mockConnection.externalConnectionId,
      );
      expect(mockDelete).toHaveBeenCalledWith(mockConnection.id);
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: mockConnection.tenantId,
        action: AuditAction.DELETE,
        resourceType: 'connection',
        resourceId: mockConnection.id,
      });
    });

    it('skips the connector call for a connection with no external connection id yet', async () => {
      const pending = { ...mockConnection, externalConnectionId: null };
      mockFindById.mockResolvedValue(pending);

      await service.delete(pending.tenantId, pending.id, auth);

      expect(mockResolve).not.toHaveBeenCalled();
      expect(mockDeleteById).not.toHaveBeenCalled();
      expect(mockDelete).toHaveBeenCalledWith(pending.id);
    });

    it('aborts the local delete when the connector call fails', async () => {
      mockFindById.mockResolvedValue(mockConnection);
      mockResolve.mockResolvedValue({
        adapter: mockAdapter,
        connector: mockConnector,
        context: mockContext,
        format: undefined,
      });
      const error = new Error('connector unavailable');
      mockDeleteById.mockRejectedValue(error);

      await expect(
        service.delete(mockConnection.tenantId, mockConnection.id, auth),
      ).rejects.toThrow(error);
      expect(mockDelete).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if connection not found on delete', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(
        service.delete(mockConnection.tenantId, mockConnection.id, auth),
      ).rejects.toThrow(NotFoundException);
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('applyProtocolStateIfForward', () => {
    it('mutates and audits the connection when the guarded update wins', async () => {
      mockUpdateStateIfForward.mockResolvedValue(true);
      const connection = {
        ...mockConnection,
        state: ConnectionState.RESPONDED,
      };

      const result = await service.applyProtocolStateIfForward(
        connection,
        ConnectionState.ACTIVE,
        [ConnectionState.RESPONDED],
      );

      expect(mockUpdateStateIfForward).toHaveBeenCalledWith(
        connection.id,
        connection.tenantId,
        ConnectionState.ACTIVE,
        [ConnectionState.RESPONDED],
        undefined,
      );
      expect(result).toBe(connection);
      expect(result?.state).toBe(ConnectionState.ACTIVE);
      expect(mockEmit).toHaveBeenCalledWith(
        {
          tenantId: connection.tenantId,
          action: AuditAction.UPDATE,
          resourceType: 'connection',
          resourceId: connection.id,
        },
        undefined,
      );
    });

    it('forwards an explicit manager through to the guarded write, e.g. inside a caller-owned transaction', async () => {
      mockUpdateStateIfForward.mockResolvedValue(true);
      const connection = {
        ...mockConnection,
        state: ConnectionState.RESPONDED,
      };
      const manager = {} as Parameters<
        ConnectionService['applyProtocolStateIfForward']
      >[3];

      await service.applyProtocolStateIfForward(
        connection,
        ConnectionState.ACTIVE,
        [ConnectionState.RESPONDED],
        manager,
      );

      expect(mockUpdateStateIfForward).toHaveBeenCalledWith(
        connection.id,
        connection.tenantId,
        ConnectionState.ACTIVE,
        [ConnectionState.RESPONDED],
        manager,
      );
      expect(mockEmit).toHaveBeenCalledWith(
        {
          tenantId: connection.tenantId,
          action: AuditAction.UPDATE,
          resourceType: 'connection',
          resourceId: connection.id,
        },
        manager,
      );
    });

    it('returns null and skips the audit when another delivery already won the race', async () => {
      mockUpdateStateIfForward.mockResolvedValue(false);
      const connection = { ...mockConnection, state: ConnectionState.ACTIVE };

      const result = await service.applyProtocolStateIfForward(
        connection,
        ConnectionState.ACTIVE,
        [ConnectionState.RESPONDED],
      );

      expect(result).toBeNull();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('createFromInvitationTemplate', () => {
    it('creates a new connection row keyed on externalId and audits it, leaving the template untouched', async () => {
      const template: Connection = {
        ...mockConnection,
        id: 'invitation-conn-1',
        externalConnectionId: undefined,
        metadata: {
          invitationId: 'invi-1',
          invitationUrl: 'https://example.com/invite',
          multiUse: true,
        },
      };
      const created: Connection = {
        ...mockConnection,
        id: 'new-conn-1',
        externalConnectionId: 'ext-1',
      };
      mockCreate.mockResolvedValue(created);
      const manager = {} as Parameters<
        ConnectionService['createFromInvitationTemplate']
      >[4];

      const result = await service.createFromInvitationTemplate(
        template,
        'ext-1',
        ConnectionState.REQUESTED,
        'did:example:456',
        manager,
      );

      expect(mockCreate).toHaveBeenCalledWith(
        {
          tenantId: template.tenantId,
          connectorType: template.connectorType,
          protocol: template.protocol,
          state: ConnectionState.REQUESTED,
          externalConnectionId: 'ext-1',
          theirDid: 'did:example:456',
          metadata: { multiUse: true },
        },
        manager,
      );
      expect(mockEmit).toHaveBeenCalledWith(
        {
          tenantId: created.tenantId,
          action: AuditAction.CREATE,
          resourceType: 'connection',
          resourceId: created.id,
        },
        manager,
      );
      expect(result).toBe(created);
    });
  });
});
