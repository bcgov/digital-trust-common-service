import { Test, TestingModule } from '@nestjs/testing';

import { CreateTenantUserDto } from './dto/create-tenant-user.dto';
import { TenantUserController } from './tenant-user.controller';
import {
  TenantUser,
  TenantUserRole,
  TenantUserStatus,
} from './tenant-user.entity';
import { TenantUserService } from './tenant-user.service';

describe('TenantUserController', () => {
  let controller: TenantUserController;

  let mockCreate: jest.Mock;
  let mockFindById: jest.Mock;
  let mockFindByTenantId: jest.Mock;
  let mockFindByExternalUserId: jest.Mock;
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
    mockUpdate = jest.fn();
    mockDelete = jest.fn();

    const mockService = {
      create: mockCreate,
      findById: mockFindById,
      findByTenantId: mockFindByTenantId,
      findByExternalUserId: mockFindByExternalUserId,
      update: mockUpdate,
      delete: mockDelete,
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenantUserController],
      providers: [
        {
          provide: TenantUserService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<TenantUserController>(TenantUserController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /tenant-users', () => {
    it('should create a new tenant user', async () => {
      const dto: CreateTenantUserDto = {
        tenantId: mockTenantUser.tenantId,
        externalUserId: mockTenantUser.externalUserId,
        email: mockTenantUser.email,
        displayName: mockTenantUser.displayName,
        role: TenantUserRole.MEMBER,
        status: TenantUserStatus.ACTIVE,
      };

      mockCreate.mockResolvedValue(mockTenantUser);

      const result = await controller.create(dto);

      expect(mockCreate).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockTenantUser);
    });
  });

  describe('GET /tenant-users/:id', () => {
    it('should return a tenant user by id', async () => {
      const id = mockTenantUser.id;
      mockFindById.mockResolvedValue(mockTenantUser);

      const result = await controller.findById(id);

      expect(mockFindById).toHaveBeenCalledWith(id);
      expect(result).toEqual(mockTenantUser);
    });

    it('should throw NotFoundException if tenant user not found', async () => {
      const id = '999e4567-e89b-12d3-a456-426614174000';
      mockFindById.mockRejectedValue(new Error('Tenant user not found'));

      await expect(controller.findById(id)).rejects.toThrow();
      expect(mockFindById).toHaveBeenCalledWith(id);
    });
  });

  describe('GET /tenant-users/tenant/:tenantId', () => {
    it('should return all tenant users for a tenant', async () => {
      const tenantId = mockTenantUser.tenantId;
      const tenantUsers = [mockTenantUser];
      mockFindByTenantId.mockResolvedValue(tenantUsers);

      const result = await controller.findByTenantId(tenantId);

      expect(mockFindByTenantId).toHaveBeenCalledWith(tenantId);
      expect(result).toEqual(tenantUsers);
    });

    it('should return empty array if no users found for tenant', async () => {
      const tenantId = mockTenantUser.tenantId;
      mockFindByTenantId.mockResolvedValue([]);

      const result = await controller.findByTenantId(tenantId);

      expect(result).toEqual([]);
    });
  });

  describe('GET /tenant-users/external/:externalUserId', () => {
    it('should return all tenant users for an external user', async () => {
      const externalUserId = mockTenantUser.externalUserId;
      const tenantUsers = [mockTenantUser];
      mockFindByExternalUserId.mockResolvedValue(tenantUsers);

      const result = await controller.findByExternalUserId(externalUserId);

      expect(mockFindByExternalUserId).toHaveBeenCalledWith(externalUserId);
      expect(result).toEqual(tenantUsers);
    });

    it('should return empty array if user not found in any tenant', async () => {
      const externalUserId = 'non-existent-user';
      mockFindByExternalUserId.mockResolvedValue([]);

      const result = await controller.findByExternalUserId(externalUserId);

      expect(result).toEqual([]);
    });
  });

  describe('PATCH /tenant-users/:id', () => {
    it('should update a tenant user', async () => {
      const id = mockTenantUser.id;
      const dto = { displayName: 'Updated Name', role: TenantUserRole.ADMIN };
      const updatedTenantUser = { ...mockTenantUser, ...dto };

      mockUpdate.mockResolvedValue(updatedTenantUser);

      const result = await controller.update(id, dto);

      expect(mockUpdate).toHaveBeenCalledWith(id, dto);
      expect(result).toEqual(updatedTenantUser);
    });

    it('should throw NotFoundException if tenant user not found', async () => {
      const id = '999e4567-e89b-12d3-a456-426614174000';
      const dto = { displayName: 'Updated Name' };

      mockUpdate.mockRejectedValue(new Error('Tenant user not found'));

      await expect(controller.update(id, dto)).rejects.toThrow();
      expect(mockUpdate).toHaveBeenCalledWith(id, dto);
    });
  });

  describe('DELETE /tenant-users/:id', () => {
    it('should delete a tenant user', async () => {
      const id = mockTenantUser.id;
      mockDelete.mockResolvedValue(undefined);

      await controller.delete(id);

      expect(mockDelete).toHaveBeenCalledWith(id);
    });

    it('should throw NotFoundException if tenant user not found', async () => {
      const id = '999e4567-e89b-12d3-a456-426614174000';
      mockDelete.mockRejectedValue(new Error('Tenant user not found'));

      await expect(controller.delete(id)).rejects.toThrow();
      expect(mockDelete).toHaveBeenCalledWith(id);
    });
  });
});
