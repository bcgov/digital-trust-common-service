import { TenantAccessDeniedException } from '@app/auth';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';

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

  beforeEach(async () => {
    mockCreate = jest.fn();
    mockFindById = jest.fn();
    mockFindByExternalConnectionId = jest.fn();
    mockFindByTenantId = jest.fn();
    mockFindByTenantIdAndState = jest.fn();
    mockUpdate = jest.fn();
    mockDelete = jest.fn();
    mockEmit = jest.fn().mockResolvedValue(undefined);

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
      ],
    }).compile();

    service = module.get<ConnectionService>(ConnectionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a new connection if it does not already exist', async () => {
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

      mockFindByExternalConnectionId.mockResolvedValue(null);
      mockCreate.mockResolvedValue(mockConnection);

      const result = await service.create(dto, auth);

      expect(mockFindByExternalConnectionId).toHaveBeenCalledWith(
        dto.externalConnectionId,
      );
      expect(mockCreate).toHaveBeenCalledWith({
        tenantId: dto.tenantId,
        externalConnectionId: dto.externalConnectionId,
        theirLabel: dto.theirLabel,
        theirDid: dto.theirDid,
        state: dto.state,
        connectorType: dto.connectorType,
        protocol: dto.protocol,
        metadata: dto.metadata || {},
      });
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: mockConnection.tenantId,
        action: AuditAction.CREATE,
        resourceType: 'connection',
        resourceId: mockConnection.id,
      });
      expect(result).toEqual(mockConnection);
    });

    it('should throw ConflictException if connection already exists', async () => {
      const dto: CreateConnectionDto = {
        tenantId: mockConnection.tenantId,
        externalConnectionId: mockConnection.externalConnectionId,
        state: mockConnection.state,
        connectorType: mockConnection.connectorType,
        protocol: mockConnection.protocol,
      };

      mockFindByExternalConnectionId.mockResolvedValue(mockConnection);

      await expect(service.create(dto, auth)).rejects.toThrow(
        ConflictException,
      );
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('rejects create when body tenant does not match the token', async () => {
      const dto: CreateConnectionDto = {
        tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        externalConnectionId: mockConnection.externalConnectionId,
        state: mockConnection.state,
        connectorType: mockConnection.connectorType,
        protocol: mockConnection.protocol,
      };

      await expect(service.create(dto, auth)).rejects.toThrow(
        TenantAccessDeniedException,
      );
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should find a connection by id', async () => {
      mockFindById.mockResolvedValue(mockConnection);

      const result = await service.findById(mockConnection.id, auth);

      expect(mockFindById).toHaveBeenCalledWith(mockConnection.id);
      expect(result).toEqual(mockConnection);
    });

    it('should throw NotFoundException if connection not found', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(service.findById(mockConnection.id, auth)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns NotFoundException for cross-tenant resource access', async () => {
      mockFindById.mockResolvedValue(mockConnection);

      await expect(
        service.findById(mockConnection.id, {
          ...auth,
          tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByExternalConnectionId', () => {
    it('should find a connection by external connection id', async () => {
      mockFindByExternalConnectionId.mockResolvedValue(mockConnection);

      const result = await service.findByExternalConnectionId(
        mockConnection.externalConnectionId,
        auth,
      );

      expect(mockFindByExternalConnectionId).toHaveBeenCalledWith(
        mockConnection.externalConnectionId,
      );
      expect(result).toEqual(mockConnection);
    });

    it('should throw NotFoundException if connection not found', async () => {
      mockFindByExternalConnectionId.mockResolvedValue(null);

      await expect(
        service.findByExternalConnectionId(
          mockConnection.externalConnectionId,
          auth,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByTenantId', () => {
    it('should find connections by tenant id', async () => {
      mockFindByTenantId.mockResolvedValue([mockConnection]);

      const result = await service.findByTenantId(mockConnection.tenantId);

      expect(mockFindByTenantId).toHaveBeenCalledWith(mockConnection.tenantId);
      expect(result).toEqual([mockConnection]);
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
      expect(result).toEqual([mockConnection]);
    });
  });

  describe('update', () => {
    it('should update a connection', async () => {
      const dto: Partial<CreateConnectionDto> = {
        state: ConnectionState.COMPLETED,
      };

      mockFindById.mockResolvedValue(mockConnection);
      mockUpdate.mockResolvedValue({ ...mockConnection, ...dto });

      const result = await service.update(mockConnection.id, dto, auth);

      expect(mockFindById).toHaveBeenCalledWith(mockConnection.id);
      expect(mockUpdate).toHaveBeenCalled();
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: mockConnection.tenantId,
        action: AuditAction.UPDATE,
        resourceType: 'connection',
        resourceId: mockConnection.id,
      });
      expect(result.state).toEqual(ConnectionState.COMPLETED);
    });

    it('should throw NotFoundException if connection not found on update', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(service.update(mockConnection.id, {}, auth)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('delete', () => {
    it('should delete a connection', async () => {
      mockFindById.mockResolvedValue(mockConnection);

      await service.delete(mockConnection.id, auth);

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

      await expect(service.delete(mockConnection.id, auth)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });
});
