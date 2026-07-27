import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

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

  beforeEach(async () => {
    mockCreate = jest.fn();
    mockFindById = jest.fn();
    mockFindByExternalConnectionId = jest.fn();
    mockFindByTenantId = jest.fn();
    mockFindByTenantIdAndState = jest.fn();
    mockUpdate = jest.fn();
    mockDelete = jest.fn();

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

      const result = await service.create(dto);

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

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('findById', () => {
    it('should find a connection by id', async () => {
      mockFindById.mockResolvedValue(mockConnection);

      const result = await service.findById(mockConnection.id);

      expect(mockFindById).toHaveBeenCalledWith(mockConnection.id);
      expect(result).toEqual(mockConnection);
    });

    it('should throw NotFoundException if connection not found', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(service.findById(mockConnection.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByExternalConnectionId', () => {
    it('should find a connection by external connection id', async () => {
      mockFindByExternalConnectionId.mockResolvedValue(mockConnection);

      const result = await service.findByExternalConnectionId(
        mockConnection.externalConnectionId,
      );

      expect(mockFindByExternalConnectionId).toHaveBeenCalledWith(
        mockConnection.externalConnectionId,
      );
      expect(result).toEqual(mockConnection);
    });

    it('should throw NotFoundException if connection not found', async () => {
      mockFindByExternalConnectionId.mockResolvedValue(null);

      await expect(
        service.findByExternalConnectionId(mockConnection.externalConnectionId),
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

      const result = await service.update(mockConnection.id, dto);

      expect(mockFindById).toHaveBeenCalledWith(mockConnection.id);
      expect(mockUpdate).toHaveBeenCalled();
      expect(result.state).toEqual(ConnectionState.COMPLETED);
    });

    it('should throw NotFoundException if connection not found on update', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(service.update(mockConnection.id, {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('delete', () => {
    it('should delete a connection', async () => {
      mockFindById.mockResolvedValue(mockConnection);

      await service.delete(mockConnection.id);

      expect(mockFindById).toHaveBeenCalledWith(mockConnection.id);
      expect(mockDelete).toHaveBeenCalledWith(mockConnection.id);
    });

    it('should throw NotFoundException if connection not found on delete', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(service.delete(mockConnection.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
