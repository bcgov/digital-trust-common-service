/* eslint-disable @typescript-eslint/unbound-method */
import {
  JwtGuard,
  PLATFORM_ADMIN_ROLE,
  ScopeGuard,
  TENANT_SUPERUSER_SCOPE,
} from '@app/auth';
import { CanActivate } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';

import { CreateTenantDto } from './dto/create-tenant.dto';
import { TenantController } from './tenant.controller';
import { Tenant, TenantStatus } from './tenant.entity';
import { TenantService } from './tenant.service';

class AllowGuard implements CanActivate {
  public canActivate(): boolean {
    return true;
  }
}

describe('TenantController', () => {
  let controller: TenantController;

  let mockCreate: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockUpdateStatus: jest.Mock;
  let mockList: jest.Mock;
  let mockFindById: jest.Mock;
  let mockFindBySlug: jest.Mock;
  let mockDelete: jest.Mock;
  let mockRestore: jest.Mock;

  const mockTenant: Tenant = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Test Tenant',
    slug: 'test-tenant',
    description: 'A test tenant',
    status: TenantStatus.ACTIVE,
    config: {},
    created_at: new Date(),
    updated_at: new Date(),
    users: [],
  };

  beforeEach(async () => {
    mockCreate = jest.fn();
    mockUpdate = jest.fn();
    mockUpdateStatus = jest.fn();
    mockList = jest.fn();
    mockFindById = jest.fn();
    mockFindBySlug = jest.fn();
    mockDelete = jest.fn();
    mockRestore = jest.fn();

    const mockService = {
      create: mockCreate,
      update: mockUpdate,
      updateStatus: mockUpdateStatus,
      list: mockList,
      findById: mockFindById,
      findBySlug: mockFindBySlug,
      delete: mockDelete,
      restore: mockRestore,
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenantController],
      providers: [
        {
          provide: TenantService,
          useValue: mockService,
        },
      ],
    })
      .overrideGuard(JwtGuard)
      .useClass(AllowGuard)
      .overrideGuard(ScopeGuard)
      .useClass(AllowGuard)
      .compile();

    controller = module.get<TenantController>(TenantController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('requires platform-admin for tenant creation and deletion', () => {
    const createRoles = new Reflector().get<string[]>(
      'required_roles',
      TenantController.prototype.create,
    );
    const deleteRoles = new Reflector().get<string[]>(
      'required_roles',
      TenantController.prototype.delete,
    );

    expect(createRoles).toEqual([PLATFORM_ADMIN_ROLE]);
    expect(deleteRoles).toEqual([PLATFORM_ADMIN_ROLE]);
  });

  it('requires platform-admin for tenant status updates', () => {
    const updateStatusRoles = new Reflector().get<string[]>(
      'required_roles',
      TenantController.prototype.updateStatus,
    );

    expect(updateStatusRoles).toEqual([PLATFORM_ADMIN_ROLE]);
  });

  it('requires tenant superuser scope for tenant updates', () => {
    const updateScopes = new Reflector().get<string[]>(
      'required_scopes',
      TenantController.prototype.update,
    );

    expect(updateScopes).toEqual([TENANT_SUPERUSER_SCOPE]);
  });

  it('allows platform-admin to read any tenant and restricts tenant member reads to their tenant', async () => {
    mockFindById.mockResolvedValue(mockTenant);

    await expect(
      controller.findById(mockTenant.id, {
        roles: [PLATFORM_ADMIN_ROLE],
      } as never),
    ).resolves.toEqual(mockTenant);

    mockFindById.mockResolvedValue(mockTenant);
    await expect(
      controller.findById(mockTenant.id, {
        roles: [],
        tenantId: 'other-tenant',
      } as never),
    ).rejects.toMatchObject({
      response: {
        error: {
          code: 'TENANT_ACCESS_DENIED',
        },
      },
    });
  });

  describe('POST /tenants', () => {
    it('should create a new tenant', async () => {
      const dto: CreateTenantDto = {
        name: 'New Tenant',
        slug: 'new-tenant',
        description: 'A new tenant',
        config: {},
        ownerEmail: 'owner@new-tenant.example',
      };

      mockCreate.mockResolvedValue(mockTenant);

      const result = await controller.create(dto, {
        roles: [PLATFORM_ADMIN_ROLE],
      } as never);

      expect(mockCreate).toHaveBeenCalledWith(dto, {
        roles: [PLATFORM_ADMIN_ROLE],
      });
      expect(result).toEqual(mockTenant);
    });
  });

  describe('PATCH /tenants/:id', () => {
    it('should update a tenant', async () => {
      const id = mockTenant.id;
      const dto: Partial<CreateTenantDto> = { name: 'Updated Name' };
      const updatedTenant = { ...mockTenant, ...dto };

      mockUpdate.mockResolvedValue(updatedTenant);

      const result = await controller.update(dto, id, {
        roles: [PLATFORM_ADMIN_ROLE],
        tenantId: mockTenant.id,
      } as never);

      expect(mockUpdate).toHaveBeenCalledWith(id, dto);
      expect(result).toEqual(updatedTenant);
    });
  });

  describe('GET /tenants', () => {
    it('should return a paginated list of tenants for platform-admins', async () => {
      const page = {
        data: [mockTenant],
        pagination: { next_cursor: null, has_more: false },
      };
      mockList.mockResolvedValue(page);

      const result = await controller.list({}, {
        roles: [PLATFORM_ADMIN_ROLE],
      } as never);

      expect(mockList).toHaveBeenCalledWith({
        limit: undefined,
        cursor: undefined,
      });
      expect(result).toEqual(page);
    });

    it('should return the caller tenant for tenant-scoped users', async () => {
      mockFindById.mockResolvedValue(mockTenant);

      const result = await controller.list({}, {
        roles: [],
        tenantId: mockTenant.id,
      } as never);

      expect(mockFindById).toHaveBeenCalledWith(mockTenant.id);
      expect(mockList).not.toHaveBeenCalled();
      expect(result).toEqual({
        data: [mockTenant],
        pagination: { next_cursor: null, has_more: false },
      });
    });

    it('should return an empty page if no auth context is present', async () => {
      const result = await controller.list({}, undefined);

      expect(result).toEqual({
        data: [],
        pagination: { next_cursor: null, has_more: false },
      });
    });
  });

  describe('GET /tenants/:id', () => {
    it('should return a tenant by id', async () => {
      const id = mockTenant.id;
      mockFindById.mockResolvedValue(mockTenant);

      const result = await controller.findById(id, {
        roles: [PLATFORM_ADMIN_ROLE],
        tenantId: mockTenant.id,
      } as never);

      expect(mockFindById).toHaveBeenCalledWith(id);
      expect(result).toEqual(mockTenant);
    });

    it('should return null if tenant not found', async () => {
      const id = '999e4567-e89b-12d3-a456-426614174000';
      mockFindById.mockResolvedValue(null);

      const result = await controller.findById(id, {
        roles: [PLATFORM_ADMIN_ROLE],
        tenantId: mockTenant.id,
      } as never);

      expect(result).toBeNull();
    });
  });

  describe('GET /tenants/slug/:slug', () => {
    it('should return a tenant by slug', async () => {
      const slug = mockTenant.slug;
      mockFindBySlug.mockResolvedValue(mockTenant);

      const result = await controller.findBySlug(slug, {
        roles: [PLATFORM_ADMIN_ROLE],
        tenantId: mockTenant.id,
      } as never);

      expect(mockFindBySlug).toHaveBeenCalledWith(slug);
      expect(result).toEqual(mockTenant);
    });

    it('should return null if tenant not found', async () => {
      const slug = 'non-existent-slug';
      mockFindBySlug.mockResolvedValue(null);

      const result = await controller.findBySlug(slug, {
        roles: [PLATFORM_ADMIN_ROLE],
        tenantId: mockTenant.id,
      } as never);

      expect(result).toBeNull();
    });
  });

  describe('PATCH /tenants/:id/status', () => {
    it('should update a tenant status', async () => {
      const id = mockTenant.id;
      const updated = { ...mockTenant, status: TenantStatus.SUSPENDED };

      mockUpdateStatus.mockResolvedValue(updated);

      const result = await controller.updateStatus(id, {
        status: TenantStatus.SUSPENDED,
      });

      expect(mockUpdateStatus).toHaveBeenCalledWith(id, TenantStatus.SUSPENDED);
      expect(result).toEqual(updated);
    });
  });

  describe('DELETE /tenants/:id', () => {
    it('should delete a tenant', async () => {
      const id = mockTenant.id;
      mockDelete.mockResolvedValue(undefined);

      await controller.delete(id);

      expect(mockDelete).toHaveBeenCalledWith(id);
    });
  });

  describe('POST /tenants/:id/restore', () => {
    it('should restore a deleted tenant', async () => {
      const id = mockTenant.id;
      mockRestore.mockResolvedValue(undefined);

      await controller.restore(id);

      expect(mockRestore).toHaveBeenCalledWith(id);
    });
  });
});
