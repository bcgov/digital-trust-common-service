import { JwtGuard, ScopeGuard, TenantGuard } from '@app/auth';
import { CanActivate } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { InviteTenantUserDto } from './dto/invite-tenant-user.dto';
import { TenantMembershipGuard } from './tenant-membership.guard';
import { TenantUserController } from './tenant-user.controller';
import {
  TenantUser,
  TenantUserRole,
  TenantUserStatus,
} from './tenant-user.entity';
import { TenantUserService } from './tenant-user.service';

class AllowGuard implements CanActivate {
  public canActivate(): boolean {
    return true;
  }
}

describe('TenantUserController', () => {
  let controller: TenantUserController;

  let mockInvite: jest.Mock;
  let mockList: jest.Mock;
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
    mockInvite = jest.fn();
    mockList = jest.fn();
    mockUpdate = jest.fn();
    mockDelete = jest.fn();

    const mockService = {
      invite: mockInvite,
      list: mockList,
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
    })
      .overrideGuard(JwtGuard)
      .useClass(AllowGuard)
      .overrideGuard(ScopeGuard)
      .useClass(AllowGuard)
      .overrideGuard(TenantGuard)
      .useClass(AllowGuard)
      .overrideGuard(TenantMembershipGuard)
      .useClass(AllowGuard)
      .compile();

    controller = module.get<TenantUserController>(TenantUserController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /tenants/:tenantId/users', () => {
    it('should invite a new tenant user', async () => {
      const tenantId = mockTenantUser.tenantId;
      const dto: InviteTenantUserDto = {
        email: mockTenantUser.email,
        role: TenantUserRole.MEMBER,
      };

      mockInvite.mockResolvedValue(mockTenantUser);

      const result = await controller.create(tenantId, dto);

      expect(mockInvite).toHaveBeenCalledWith(tenantId, dto);
      expect(result).toEqual(mockTenantUser);
    });
  });

  describe('GET /tenants/:tenantId/users', () => {
    it('should return a paginated list of tenant users', async () => {
      const tenantId = mockTenantUser.tenantId;
      const page = {
        data: [mockTenantUser],
        pagination: { next_cursor: null, has_more: false },
      };
      mockList.mockResolvedValue(page);

      const result = await controller.list(tenantId, {});

      expect(mockList).toHaveBeenCalledWith(tenantId, {
        limit: undefined,
        cursor: undefined,
      });
      expect(result).toEqual(page);
    });

    it('should pass cursor and limit query params through to the service', async () => {
      const tenantId = mockTenantUser.tenantId;
      const page = {
        data: [],
        pagination: { next_cursor: null, has_more: false },
      };
      mockList.mockResolvedValue(page);

      const result = await controller.list(tenantId, {
        cursor: 'some-cursor',
        limit: 10,
      });

      expect(mockList).toHaveBeenCalledWith(tenantId, {
        limit: 10,
        cursor: 'some-cursor',
      });
      expect(result).toEqual(page);
    });
  });

  describe('PATCH /tenants/:tenantId/users/:userId', () => {
    it('should update a tenant user', async () => {
      const tenantId = mockTenantUser.tenantId;
      const userId = mockTenantUser.id;
      const dto = { displayName: 'Updated Name', role: TenantUserRole.ADMIN };
      const updatedTenantUser = { ...mockTenantUser, ...dto };

      mockUpdate.mockResolvedValue(updatedTenantUser);

      const result = await controller.update(tenantId, userId, dto);

      expect(mockUpdate).toHaveBeenCalledWith(tenantId, userId, dto, undefined);
      expect(result).toEqual(updatedTenantUser);
    });

    it("forwards the caller's own TenantUser id for the self-role-change check", async () => {
      const tenantId = mockTenantUser.tenantId;
      const userId = '999e4567-e89b-12d3-a456-426614174002';
      const dto = { role: TenantUserRole.MEMBER };
      const callerTenantUser = {
        ...mockTenantUser,
        id: '999e4567-e89b-12d3-a456-426614174003',
        role: TenantUserRole.ADMIN,
      };
      const updatedTenantUser = { ...mockTenantUser, id: userId, ...dto };

      mockUpdate.mockResolvedValue(updatedTenantUser);

      const result = await controller.update(
        tenantId,
        userId,
        dto,
        callerTenantUser,
      );

      expect(mockUpdate).toHaveBeenCalledWith(
        tenantId,
        userId,
        dto,
        callerTenantUser.id,
      );
      expect(result).toEqual(updatedTenantUser);
    });

    it('should throw NotFoundException if tenant user not found', async () => {
      const tenantId = mockTenantUser.tenantId;
      const userId = '999e4567-e89b-12d3-a456-426614174000';
      const dto = { displayName: 'Updated Name' };

      mockUpdate.mockRejectedValue(new Error('Tenant user not found'));

      await expect(controller.update(tenantId, userId, dto)).rejects.toThrow();
      expect(mockUpdate).toHaveBeenCalledWith(tenantId, userId, dto, undefined);
    });
  });

  describe('DELETE /tenants/:tenantId/users/:userId', () => {
    it('should delete a tenant user', async () => {
      const tenantId = mockTenantUser.tenantId;
      const userId = mockTenantUser.id;
      mockDelete.mockResolvedValue(undefined);

      await controller.delete(tenantId, userId);

      expect(mockDelete).toHaveBeenCalledWith(tenantId, userId);
    });

    it('should throw NotFoundException if tenant user not found', async () => {
      const tenantId = mockTenantUser.tenantId;
      const userId = '999e4567-e89b-12d3-a456-426614174000';
      mockDelete.mockRejectedValue(new Error('Tenant user not found'));

      await expect(controller.delete(tenantId, userId)).rejects.toThrow();
      expect(mockDelete).toHaveBeenCalledWith(tenantId, userId);
    });
  });
});
