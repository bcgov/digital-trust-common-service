import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from 'typeorm';

import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';

import { CreateTenantUserDto } from './dto/create-tenant-user.dto';
import { InviteTenantUserDto } from './dto/invite-tenant-user.dto';
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
  let mockFindByTenantAndId: jest.Mock;
  let mockCountByTenantAndRole: jest.Mock;
  let mockFindPageForTenant: jest.Mock;
  let mockFindByExternalUserId: jest.Mock;
  let mockFindActiveByExternalUserId: jest.Mock;
  let mockFindByTenantAndExternalUserId: jest.Mock;
  let mockFindByTenantAndEmail: jest.Mock;
  let mockClaimInvitedByEmail: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockDelete: jest.Mock;
  let mockEmit: jest.Mock;

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
    mockFindByTenantAndId = jest.fn();
    mockCountByTenantAndRole = jest.fn();
    mockFindPageForTenant = jest.fn();
    mockFindByExternalUserId = jest.fn();
    mockFindActiveByExternalUserId = jest.fn();
    mockFindByTenantAndExternalUserId = jest.fn();
    mockFindByTenantAndEmail = jest.fn();
    mockClaimInvitedByEmail = jest.fn();
    mockUpdate = jest.fn();
    mockDelete = jest.fn();
    mockEmit = jest.fn().mockResolvedValue(undefined);

    const mockRepository = {
      create: mockCreate,
      findById: mockFindById,
      findByTenantAndId: mockFindByTenantAndId,
      countByTenantAndRole: mockCountByTenantAndRole,
      findPageForTenant: mockFindPageForTenant,
      findByExternalUserId: mockFindByExternalUserId,
      findActiveByExternalUserId: mockFindActiveByExternalUserId,
      findByTenantAndExternalUserId: mockFindByTenantAndExternalUserId,
      findByTenantAndEmail: mockFindByTenantAndEmail,
      claimInvitedByEmail: mockClaimInvitedByEmail,
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
        {
          provide: DomainAuditService,
          useValue: { emit: mockEmit },
        },
      ],
    }).compile();

    service = module.get<TenantUserService>(TenantUserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('invite', () => {
    it('should invite a new tenant user by email if they do not already exist', async () => {
      const tenantId = mockTenantUser.tenantId;
      const dto: InviteTenantUserDto = {
        email: mockTenantUser.email,
        role: TenantUserRole.MEMBER,
      };
      const invited = { ...mockTenantUser, status: TenantUserStatus.INVITED };

      mockFindByTenantAndEmail.mockResolvedValue(null);
      mockCreate.mockResolvedValue(invited);

      const result = await service.invite(tenantId, dto);

      expect(mockFindByTenantAndEmail).toHaveBeenCalledWith(
        tenantId,
        dto.email,
        undefined,
      );
      expect(mockCreate).toHaveBeenCalledWith(
        {
          tenantId,
          email: dto.email,
          role: dto.role,
          status: TenantUserStatus.INVITED,
        },
        undefined,
      );
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: invited.tenantId,
        action: AuditAction.CREATE,
        resourceType: 'tenant_user',
        resourceId: invited.id,
      });
      expect(result).toEqual(invited);
    });

    it('should throw ConflictException if a tenant user with this email already exists', async () => {
      const tenantId = mockTenantUser.tenantId;
      const dto: InviteTenantUserDto = {
        email: mockTenantUser.email,
        role: TenantUserRole.MEMBER,
      };

      mockFindByTenantAndEmail.mockResolvedValue(mockTenantUser);

      await expect(service.invite(tenantId, dto)).rejects.toThrow(
        ConflictException,
      );
      expect(mockFindByTenantAndEmail).toHaveBeenCalledWith(
        tenantId,
        dto.email,
        undefined,
      );
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('should not emit its own audit event when called with a transaction manager', async () => {
      const tenantId = mockTenantUser.tenantId;
      const dto: InviteTenantUserDto = {
        email: mockTenantUser.email,
        role: TenantUserRole.MEMBER,
      };
      const invited = { ...mockTenantUser, status: TenantUserStatus.INVITED };
      const manager = {} as EntityManager;

      mockFindByTenantAndEmail.mockResolvedValue(null);
      mockCreate.mockResolvedValue(invited);

      const result = await service.invite(tenantId, dto, manager);

      expect(mockFindByTenantAndEmail).toHaveBeenCalledWith(
        tenantId,
        dto.email,
        manager,
      );
      expect(mockCreate).toHaveBeenCalledWith(
        {
          tenantId,
          email: dto.email,
          role: dto.role,
          status: TenantUserStatus.INVITED,
        },
        manager,
      );
      expect(mockEmit).not.toHaveBeenCalled();
      expect(result).toEqual(invited);
    });
  });

  describe('create', () => {
    it('should create a new tenant user if user does not already exist', async () => {
      const dto: CreateTenantUserDto = {
        tenantId: mockTenantUser.tenantId,
        externalUserId: mockTenantUser.externalUserId as string,
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
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: mockTenantUser.tenantId,
        action: AuditAction.CREATE,
        resourceType: 'tenant_user',
        resourceId: mockTenantUser.id,
      });
      expect(result).toEqual(mockTenantUser);
    });

    it('should throw ConflictException if user already belongs to tenant', async () => {
      const dto: CreateTenantUserDto = {
        tenantId: mockTenantUser.tenantId,
        externalUserId: mockTenantUser.externalUserId as string,
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
      expect(mockEmit).not.toHaveBeenCalled();
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

  describe('list', () => {
    it('should return a paginated page of tenant users with no next cursor when there is no more data', async () => {
      const tenantId = mockTenantUser.tenantId;
      mockFindPageForTenant.mockResolvedValue({
        items: [mockTenantUser],
        nextCursor: null,
        hasMore: false,
      });

      const result = await service.list(tenantId, {});

      expect(mockFindPageForTenant).toHaveBeenCalledWith(tenantId, {
        limit: 20,
        cursor: null,
      });
      expect(result).toEqual({
        data: [mockTenantUser],
        pagination: { next_cursor: null, has_more: false },
      });
    });

    it('should encode a next_cursor when there is more data', async () => {
      const tenantId = mockTenantUser.tenantId;
      const nextCursor = {
        createdAt: mockTenantUser.createdAt.toISOString(),
        id: mockTenantUser.id,
      };
      mockFindPageForTenant.mockResolvedValue({
        items: [mockTenantUser],
        nextCursor,
        hasMore: true,
      });

      const result = await service.list(tenantId, { limit: 1 });

      expect(mockFindPageForTenant).toHaveBeenCalledWith(tenantId, {
        limit: 1,
        cursor: null,
      });
      expect(result.pagination.has_more).toBe(true);
      expect(result.pagination.next_cursor).toEqual(
        service.encodeCursor(nextCursor),
      );
    });

    it('should decode a provided cursor and pass it to the repository', async () => {
      const tenantId = mockTenantUser.tenantId;
      const cursor = {
        createdAt: mockTenantUser.createdAt.toISOString(),
        id: mockTenantUser.id,
      };
      const encoded = service.encodeCursor(cursor);
      mockFindPageForTenant.mockResolvedValue({
        items: [],
        nextCursor: null,
        hasMore: false,
      });

      await service.list(tenantId, { cursor: encoded });

      expect(mockFindPageForTenant).toHaveBeenCalledWith(tenantId, {
        limit: 20,
        cursor,
      });
    });

    it('should throw BadRequestException for an invalid cursor', async () => {
      const tenantId = mockTenantUser.tenantId;

      await expect(
        service.list(tenantId, { cursor: 'not-valid' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockFindPageForTenant).not.toHaveBeenCalled();
    });
  });

  describe('findByExternalUserId', () => {
    it('should return all tenant users for an external user', async () => {
      const externalUserId = mockTenantUser.externalUserId;
      const tenantUsers = [mockTenantUser];
      mockFindByExternalUserId.mockResolvedValue(tenantUsers);

      const result = await service.findByExternalUserId(
        externalUserId as string,
      );

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

  describe('claimInvitedByEmail', () => {
    it('should claim an invited tenant user and emit an audit event', async () => {
      const tenantId = mockTenantUser.tenantId;
      const email = mockTenantUser.email;
      const externalUserId = 'keycloak-user-new';
      const claimed = { ...mockTenantUser, externalUserId };

      mockClaimInvitedByEmail.mockResolvedValue(claimed);

      const result = await service.claimInvitedByEmail(
        tenantId,
        email,
        externalUserId,
      );

      expect(mockClaimInvitedByEmail).toHaveBeenCalledWith(
        tenantId,
        email,
        externalUserId,
      );
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: claimed.tenantId,
        action: AuditAction.UPDATE,
        resourceType: 'tenant_user',
        resourceId: claimed.id,
      });
      expect(result).toEqual(claimed);
    });

    it('should return null and not emit an audit event when no invited row matches', async () => {
      mockClaimInvitedByEmail.mockResolvedValue(null);

      const result = await service.claimInvitedByEmail(
        mockTenantUser.tenantId,
        mockTenantUser.email,
        'keycloak-user-new',
      );

      expect(result).toBeNull();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('findActiveByExternalUserId', () => {
    it('should return active memberships for an external user', async () => {
      const externalUserId = mockTenantUser.externalUserId;
      mockFindActiveByExternalUserId.mockResolvedValue([mockTenantUser]);

      const result = await service.findActiveByExternalUserId(externalUserId);

      expect(mockFindActiveByExternalUserId).toHaveBeenCalledWith(
        externalUserId,
      );
      expect(result).toEqual([mockTenantUser]);
    });
  });

  describe('update', () => {
    it('should update a tenant user if found', async () => {
      const tenantId = mockTenantUser.tenantId;
      const id = mockTenantUser.id;
      const dto = { displayName: 'Updated Name', role: TenantUserRole.ADMIN };
      const updatedTenantUser = {
        ...mockTenantUser,
        displayName: dto.displayName,
        role: dto.role,
      };

      mockFindByTenantAndId.mockResolvedValue(mockTenantUser);
      mockUpdate.mockResolvedValue(updatedTenantUser);

      const result = await service.update(tenantId, id, dto);

      expect(mockFindByTenantAndId).toHaveBeenCalledWith(tenantId, id);
      expect(mockCountByTenantAndRole).not.toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalled();
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: updatedTenantUser.tenantId,
        action: AuditAction.UPDATE,
        resourceType: 'tenant_user',
        resourceId: updatedTenantUser.id,
      });
      expect(result).toEqual(updatedTenantUser);
    });

    it('should throw NotFoundException if tenant user not found', async () => {
      const tenantId = mockTenantUser.tenantId;
      const id = '999e4567-e89b-12d3-a456-426614174000';
      const dto = { displayName: 'Updated Name' };

      mockFindByTenantAndId.mockResolvedValue(null);

      await expect(service.update(tenantId, id, dto)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockFindByTenantAndId).toHaveBeenCalledWith(tenantId, id);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when the caller attempts to change their own role', async () => {
      const tenantId = mockTenantUser.tenantId;
      const id = mockTenantUser.id;
      const dto = { role: TenantUserRole.ADMIN };

      mockFindByTenantAndId.mockResolvedValue(mockTenantUser);

      await expect(service.update(tenantId, id, dto, id)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockCountByTenantAndRole).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('allows a caller to update their own non-role fields', async () => {
      const tenantId = mockTenantUser.tenantId;
      const id = mockTenantUser.id;
      const dto = { displayName: 'My New Name' };
      const updatedTenantUser = {
        ...mockTenantUser,
        displayName: dto.displayName,
      };

      mockFindByTenantAndId.mockResolvedValue(mockTenantUser);
      mockUpdate.mockResolvedValue(updatedTenantUser);

      const result = await service.update(tenantId, id, dto, id);

      expect(mockUpdate).toHaveBeenCalled();
      expect(result).toEqual(updatedTenantUser);
    });

    it("should throw ConflictException when changing the tenant's last owner's role", async () => {
      const tenantId = mockTenantUser.tenantId;
      const owner = { ...mockTenantUser, role: TenantUserRole.OWNER };
      const dto = { role: TenantUserRole.ADMIN };

      mockFindByTenantAndId.mockResolvedValue(owner);
      mockCountByTenantAndRole.mockResolvedValue(1);

      await expect(service.update(tenantId, owner.id, dto)).rejects.toThrow(
        ConflictException,
      );
      expect(mockCountByTenantAndRole).toHaveBeenCalledWith(
        tenantId,
        TenantUserRole.OWNER,
      );
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should allow changing an owner role when other owners remain', async () => {
      const tenantId = mockTenantUser.tenantId;
      const owner = { ...mockTenantUser, role: TenantUserRole.OWNER };
      const dto = { role: TenantUserRole.ADMIN };
      const updatedTenantUser = { ...owner, ...dto };

      mockFindByTenantAndId.mockResolvedValue(owner);
      mockCountByTenantAndRole.mockResolvedValue(2);
      mockUpdate.mockResolvedValue(updatedTenantUser);

      const result = await service.update(tenantId, owner.id, dto);

      expect(mockCountByTenantAndRole).toHaveBeenCalledWith(
        tenantId,
        TenantUserRole.OWNER,
      );
      expect(mockUpdate).toHaveBeenCalled();
      expect(result).toEqual(updatedTenantUser);
    });

    it('should not check owner count when the role is unchanged', async () => {
      const tenantId = mockTenantUser.tenantId;
      const owner = { ...mockTenantUser, role: TenantUserRole.OWNER };
      const dto = { role: TenantUserRole.OWNER, displayName: 'Updated Name' };
      const updatedTenantUser = {
        ...owner,
        role: dto.role,
        displayName: dto.displayName,
      };

      mockFindByTenantAndId.mockResolvedValue(owner);
      mockUpdate.mockResolvedValue(updatedTenantUser);

      const result = await service.update(tenantId, owner.id, dto);

      expect(mockCountByTenantAndRole).not.toHaveBeenCalled();
      expect(result).toEqual(updatedTenantUser);
    });
  });

  describe('delete', () => {
    it('should delete a tenant user if found', async () => {
      const tenantId = mockTenantUser.tenantId;
      const id = mockTenantUser.id;
      mockFindByTenantAndId.mockResolvedValue(mockTenantUser);

      await service.delete(tenantId, id);

      expect(mockFindByTenantAndId).toHaveBeenCalledWith(tenantId, id);
      expect(mockCountByTenantAndRole).not.toHaveBeenCalled();
      expect(mockDelete).toHaveBeenCalledWith(id);
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: mockTenantUser.tenantId,
        action: AuditAction.DELETE,
        resourceType: 'tenant_user',
        resourceId: id,
      });
    });

    it('should throw NotFoundException if tenant user not found', async () => {
      const tenantId = mockTenantUser.tenantId;
      const id = '999e4567-e89b-12d3-a456-426614174000';
      mockFindByTenantAndId.mockResolvedValue(null);

      await expect(service.delete(tenantId, id)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockDelete).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it("should throw ConflictException when deleting the tenant's last owner", async () => {
      const tenantId = mockTenantUser.tenantId;
      const owner = { ...mockTenantUser, role: TenantUserRole.OWNER };

      mockFindByTenantAndId.mockResolvedValue(owner);
      mockCountByTenantAndRole.mockResolvedValue(1);

      await expect(service.delete(tenantId, owner.id)).rejects.toThrow(
        ConflictException,
      );
      expect(mockCountByTenantAndRole).toHaveBeenCalledWith(
        tenantId,
        TenantUserRole.OWNER,
      );
      expect(mockDelete).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('should allow deleting an owner when other owners remain', async () => {
      const tenantId = mockTenantUser.tenantId;
      const owner = { ...mockTenantUser, role: TenantUserRole.OWNER };

      mockFindByTenantAndId.mockResolvedValue(owner);
      mockCountByTenantAndRole.mockResolvedValue(2);

      await service.delete(tenantId, owner.id);

      expect(mockCountByTenantAndRole).toHaveBeenCalledWith(
        tenantId,
        TenantUserRole.OWNER,
      );
      expect(mockDelete).toHaveBeenCalledWith(owner.id);
      expect(mockEmit).toHaveBeenCalled();
    });
  });
});
