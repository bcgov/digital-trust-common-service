import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { CreateTenantUserDto } from './dto/create-tenant-user.dto';
import {
  TenantUser,
  TenantUserRole,
  TenantUserStatus,
} from './tenant-user.entity';
import { TenantUserRepository } from './tenant-user.repository';
import { TenantUserService } from './tenant-user.service';

describe('TenantUserService', () => {
  let service: TenantUserService;
  let mockCreate: jest.Mock;
  let mockFindById: jest.Mock;
  let mockFindByTenantId: jest.Mock;
  let mockFindByExternalUserId: jest.Mock;
  let mockFindByTenantAndExternalUserId: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockDelete: jest.Mock;

  const mockTenantUser: TenantUser = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    tenantId: '123e4567-e89b-12d3-a456-426614174001',
    externalUserId: 'keycloak-user-123',
    email: 'user@example.com',
    displayName: 'Test User',
    role: TenantUserRole.MEMBER,
    status: TenantUserStatus.ACTIVE,
    tenant: undefined as any,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockCreate = jest.fn();
    mockFindById = jest.fn();
    mockFindByTenantId = jest.fn();
    mockFindByExternalUserId = jest.fn();
    mockFindByTenantAndExternalUserId = jest.fn();
    mockUpdate = jest.fn();
    mockDelete = jest.fn();

    const mockRepository = {
      create: mockCreate,
      findById: mockFindById,
      findByTenantId: mockFindByTenantId,
      findByExternalUserId: mockFindByExternalUserId,
      findByTenantAndExternalUserId: mockFindByTenantAndExternalUserId,
      update: mockUpdate,
      delete: mockDelete,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantUserService,
        {
          provide: TenantUserRepository,
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<TenantUserService>(TenantUserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a new tenant user if user does not already exist', async () => {
      const dto: CreateTenantUserDto = {
        tenantId: mockTenantUser.tenantId,
        externalUserId: mockTenantUser.externalUserId,
        email: mockTenantUser.email,
        displayName: mockTenantUser.displayName,
        role: TenantUserRole.MEMBER,
        status: TenantUserStatus.ACTIVE,
      };

      mockFindByTenantAndExternalUserId.mockResolvedValue(null);
      mockCreate.mockResolvedValue(mockTenantUser);

      const result = await service.create(dto);

      expect(mockFindByTenantAndExternalUserId).toHaveBeenCalledWith(
        dto.tenantId,
        dto.externalUserId,
      );
      expect(mockCreate).toHaveBeenCalledWith({
        tenantId: dto.tenantId,
        externalUserId: dto.externalUserId,
        email: dto.email,
        displayName: dto.displayName,
        role: dto.role,
        status: dto.status,
      });
      expect(result).toEqual(mockTenantUser);
    });

    it('should throw ConflictException if user already belongs to tenant', async () => {
      const dto: CreateTenantUserDto = {
        tenantId: mockTenantUser.tenantId,
        externalUserId: mockTenantUser.externalUserId,
        email: mockTenantUser.email,
        displayName: mockTenantUser.displayName,
        role: TenantUserRole.MEMBER,
        status: TenantUserStatus.ACTIVE,
      };

      mockFindByTenantAndExternalUserId.mockResolvedValue(mockTenantUser);

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      expect(mockFindByTenantAndExternalUserId).toHaveBeenCalledWith(
        dto.tenantId,
        dto.externalUserId,
      );
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should return a tenant user if found', async () => {
      const id = mockTenantUser.id;
      mockFindById.mockResolvedValue(mockTenantUser);

      const result = await service.findById(id);

      expect(mockFindById).toHaveBeenCalledWith(id);
      expect(result).toEqual(mockTenantUser);
    });

    it('should throw NotFoundException if tenant user not found', async () => {
      const id = '999e4567-e89b-12d3-a456-426614174000';
      mockFindById.mockResolvedValue(null);

      await expect(service.findById(id)).rejects.toThrow(NotFoundException);
      expect(mockFindById).toHaveBeenCalledWith(id);
    });
  });

  describe('findByTenantId', () => {
    it('should return all tenant users for a tenant', async () => {
      const tenantId = mockTenantUser.tenantId;
      const tenantUsers = [mockTenantUser];
      mockFindByTenantId.mockResolvedValue(tenantUsers);

      const result = await service.findByTenantId(tenantId);

      expect(mockFindByTenantId).toHaveBeenCalledWith(tenantId);
      expect(result).toEqual(tenantUsers);
    });

    it('should return empty array if no users found for tenant', async () => {
      const tenantId = mockTenantUser.tenantId;
      mockFindByTenantId.mockResolvedValue([]);

      const result = await service.findByTenantId(tenantId);

      expect(result).toEqual([]);
    });
  });

  describe('findByExternalUserId', () => {
    it('should return all tenant users for an external user', async () => {
      const externalUserId = mockTenantUser.externalUserId;
      const tenantUsers = [mockTenantUser];
      mockFindByExternalUserId.mockResolvedValue(tenantUsers);

      const result = await service.findByExternalUserId(externalUserId);

      expect(mockFindByExternalUserId).toHaveBeenCalledWith(externalUserId);
      expect(result).toEqual(tenantUsers);
    });

    it('should return empty array if user not found in any tenant', async () => {
      const externalUserId = 'non-existent-user';
      mockFindByExternalUserId.mockResolvedValue([]);

      const result = await service.findByExternalUserId(externalUserId);

      expect(result).toEqual([]);
    });
  });

  describe('update', () => {
    it('should update a tenant user if found', async () => {
      const id = mockTenantUser.id;
      const dto = { displayName: 'Updated Name', role: TenantUserRole.ADMIN };
      const updatedTenantUser = { ...mockTenantUser, ...dto };

      mockFindById.mockResolvedValue(mockTenantUser);
      mockUpdate.mockResolvedValue(updatedTenantUser);

      const result = await service.update(id, dto);

      expect(mockFindById).toHaveBeenCalledWith(id);
      expect(mockUpdate).toHaveBeenCalled();
      expect(result).toEqual(updatedTenantUser);
    });

    it('should throw NotFoundException if tenant user not found', async () => {
      const id = '999e4567-e89b-12d3-a456-426614174000';
      const dto = { displayName: 'Updated Name' };

      mockFindById.mockResolvedValue(null);

      await expect(service.update(id, dto)).rejects.toThrow(NotFoundException);
      expect(mockFindById).toHaveBeenCalledWith(id);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('should delete a tenant user if found', async () => {
      const id = mockTenantUser.id;
      mockFindById.mockResolvedValue(mockTenantUser);

      await service.delete(id);

      expect(mockFindById).toHaveBeenCalledWith(id);
      expect(mockDelete).toHaveBeenCalledWith(id);
    });

    it('should throw NotFoundException if tenant user not found', async () => {
      const id = '999e4567-e89b-12d3-a456-426614174000';
      mockFindById.mockResolvedValue(null);

      await expect(service.delete(id)).rejects.toThrow(NotFoundException);
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });
});
