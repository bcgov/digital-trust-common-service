import { JOB_QUEUES } from '@app/pg-boss';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';

import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { JobsService } from '../jobs/jobs.service';
import { TenantUserRole } from '../tenant-user/tenant-user.entity';
import { TenantUserService } from '../tenant-user/tenant-user.service';

import { CreateTenantDto } from './dto/create-tenant.dto';
import { Tenant, TenantStatus } from './tenant.entity';
import { TenantRepository } from './tenant.repository';
import { TenantService } from './tenant.service';

describe('TenantService', () => {
  let service: TenantService;
  let mockCreate: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockFindPage: jest.Mock;
  let mockFindById: jest.Mock;
  let mockFindBySlug: jest.Mock;
  let mockDelete: jest.Mock;
  let mockRestore: jest.Mock;
  let mockEmit: jest.Mock;
  let mockInvite: jest.Mock;
  let mockTransaction: jest.Mock;
  let mockPublish: jest.Mock;
  const mockManager = {} as EntityManager;

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
    mockFindPage = jest.fn();
    mockFindById = jest.fn();
    mockFindBySlug = jest.fn();
    mockDelete = jest.fn();
    mockRestore = jest.fn();
    mockEmit = jest.fn().mockResolvedValue(undefined);
    mockInvite = jest.fn().mockResolvedValue({
      id: 'owner-tenant-user-id',
      tenantId: mockTenant.id,
    });
    mockTransaction = jest.fn(
      async (callback: (manager: EntityManager) => Promise<unknown>) =>
        callback(mockManager),
    );
    mockPublish = jest.fn().mockResolvedValue('job-id');

    const mockRepository = {
      create: mockCreate,
      update: mockUpdate,
      findPage: mockFindPage,
      findById: mockFindById,
      findBySlug: mockFindBySlug,
      delete: mockDelete,
      restore: mockRestore,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantService,
        {
          provide: TenantRepository,
          useValue: mockRepository,
        },
        {
          provide: DomainAuditService,
          useValue: { emit: mockEmit },
        },
        {
          provide: TenantUserService,
          useValue: { invite: mockInvite },
        },
        {
          provide: DataSource,
          useValue: { transaction: mockTransaction },
        },
        {
          provide: JobsService,
          useValue: { publish: mockPublish },
        },
      ],
    }).compile();

    service = module.get<TenantService>(TenantService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a new tenant if slug does not exist', async () => {
      const dto: CreateTenantDto = {
        name: 'New Tenant',
        slug: 'new-tenant',
        description: 'A new tenant',
        config: {},
        ownerEmail: 'owner@new-tenant.example',
      };

      mockFindBySlug.mockResolvedValue(null);
      mockCreate.mockReturnValue(mockTenant);
      mockUpdate.mockResolvedValue(mockTenant);
      mockInvite.mockResolvedValue({
        id: 'owner-tenant-user-id',
        tenantId: mockTenant.id,
      });

      const result = await service.create(dto, { roles: ['platform-admin'] });

      expect(mockFindBySlug).toHaveBeenCalledWith(dto.slug, true);
      expect(mockCreate).toHaveBeenCalledWith({
        name: dto.name,
        slug: dto.slug,
        description: dto.description,
        config: dto.config,
        status: 'active',
      });
      expect(mockUpdate).toHaveBeenCalledWith(mockTenant, mockManager);
      expect(mockInvite).toHaveBeenCalledWith(
        mockTenant.id,
        {
          email: dto.ownerEmail,
          role: TenantUserRole.OWNER,
        },
        mockManager,
      );
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: mockTenant.id,
        action: AuditAction.CREATE,
        resourceType: 'tenant',
        resourceId: mockTenant.id,
      });
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: mockTenant.id,
        action: AuditAction.CREATE,
        resourceType: 'tenant_user',
        resourceId: 'owner-tenant-user-id',
      });
      expect(result).toEqual(mockTenant);
    });

    it('should create a pending-approval tenant for self-service requests', async () => {
      const dto: CreateTenantDto = {
        name: 'New Tenant',
        slug: 'new-tenant',
        description: 'A new tenant',
        config: {},
        ownerEmail: 'owner@new-tenant.example',
      };

      mockFindBySlug.mockResolvedValue(null);
      mockCreate.mockReturnValue({ ...mockTenant, status: 'pending_approval' });
      mockUpdate.mockResolvedValue({
        ...mockTenant,
        status: 'pending_approval',
      });

      const result = await service.create(dto, { roles: [] });

      expect(mockCreate).toHaveBeenCalledWith({
        name: dto.name,
        slug: dto.slug,
        description: dto.description,
        config: dto.config,
        status: 'pending_approval',
      });
      expect(result.status).toBe('pending_approval');
    });

    it('should throw ConflictException if slug already exists, including soft-deleted rows', async () => {
      const dto: CreateTenantDto = {
        name: 'New Tenant',
        slug: 'test-tenant',
        description: 'A new tenant',
        config: {},
        ownerEmail: 'owner@test-tenant.example',
      };

      mockFindBySlug.mockResolvedValue({
        ...mockTenant,
        deleted_at: new Date(),
      });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      expect(mockFindBySlug).toHaveBeenCalledWith(dto.slug, true);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
      expect(mockInvite).not.toHaveBeenCalled();
    });

    it('should propagate an owner invite failure without emitting any audit event', async () => {
      const dto: CreateTenantDto = {
        name: 'New Tenant',
        slug: 'new-tenant',
        description: 'A new tenant',
        config: {},
        ownerEmail: 'owner@new-tenant.example',
      };

      mockFindBySlug.mockResolvedValue(null);
      mockCreate.mockReturnValue(mockTenant);
      mockUpdate.mockResolvedValue(mockTenant);
      mockInvite.mockRejectedValue(new ConflictException('email conflict'));

      await expect(service.create(dto)).rejects.toThrow(ConflictException);

      expect(mockUpdate).toHaveBeenCalledWith(mockTenant, mockManager);
      expect(mockInvite).toHaveBeenCalledWith(
        mockTenant.id,
        { email: dto.ownerEmail, role: TenantUserRole.OWNER },
        mockManager,
      );
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update a tenant if found', async () => {
      const id = mockTenant.id;
      const dto: Partial<CreateTenantDto> = { name: 'Updated Name' };
      const updatedTenant = { ...mockTenant, ...dto };

      mockFindById.mockResolvedValue(mockTenant);
      mockUpdate.mockResolvedValue(updatedTenant);

      const result = await service.update(id, dto);

      expect(mockFindById).toHaveBeenCalledWith(id);
      expect(mockUpdate).toHaveBeenCalled();
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: updatedTenant.id,
        action: AuditAction.UPDATE,
        resourceType: 'tenant',
        resourceId: updatedTenant.id,
      });
      expect(result).toEqual(updatedTenant);
    });

    it('should throw NotFoundException if tenant not found', async () => {
      const id = '999e4567-e89b-12d3-a456-426614174000';
      const dto: Partial<CreateTenantDto> = { name: 'Updated Name' };

      mockFindById.mockResolvedValue(null);

      await expect(service.update(id, dto)).rejects.toThrow(NotFoundException);
      expect(mockFindById).toHaveBeenCalledWith(id);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('should return a paginated page of tenants with no next cursor when there is no more data', async () => {
      mockFindPage.mockResolvedValue({
        items: [mockTenant],
        nextCursor: null,
        hasMore: false,
      });

      const result = await service.list({});

      expect(mockFindPage).toHaveBeenCalledWith({ limit: 20, cursor: null });
      expect(result).toEqual({
        data: [mockTenant],
        pagination: { next_cursor: null, has_more: false },
      });
    });

    it('should encode a next_cursor when there is more data', async () => {
      const nextCursor = {
        createdAt: mockTenant.created_at.toISOString(),
        id: mockTenant.id,
      };
      mockFindPage.mockResolvedValue({
        items: [mockTenant],
        nextCursor,
        hasMore: true,
      });

      const result = await service.list({ limit: 1 });

      expect(mockFindPage).toHaveBeenCalledWith({ limit: 1, cursor: null });
      expect(result.pagination.has_more).toBe(true);
      expect(result.pagination.next_cursor).toEqual(
        service.encodeCursor(nextCursor),
      );
    });

    it('should decode a provided cursor and pass it to the repository', async () => {
      const cursor = {
        createdAt: mockTenant.created_at.toISOString(),
        id: mockTenant.id,
      };
      const encoded = service.encodeCursor(cursor);
      mockFindPage.mockResolvedValue({
        items: [],
        nextCursor: null,
        hasMore: false,
      });

      await service.list({ cursor: encoded });

      expect(mockFindPage).toHaveBeenCalledWith({ limit: 20, cursor });
    });

    it('should throw BadRequestException for an invalid cursor', async () => {
      await expect(service.list({ cursor: 'not-valid' })).rejects.toThrow(
        BadRequestException,
      );
      expect(mockFindPage).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should return a tenant if found', async () => {
      const id = mockTenant.id;
      mockFindById.mockResolvedValue(mockTenant);

      const result = await service.findById(id);

      expect(mockFindById).toHaveBeenCalledWith(id);
      expect(result).toEqual(mockTenant);
    });

    it('should throw NotFoundException if tenant not found', async () => {
      const id = '999e4567-e89b-12d3-a456-426614174000';
      mockFindById.mockResolvedValue(null);

      await expect(service.findById(id)).rejects.toThrow(NotFoundException);
      expect(mockFindById).toHaveBeenCalledWith(id);
    });
  });

  describe('findBySlug', () => {
    it('should return a tenant if found', async () => {
      const slug = mockTenant.slug;
      mockFindBySlug.mockResolvedValue(mockTenant);

      const result = await service.findBySlug(slug);

      expect(mockFindBySlug).toHaveBeenCalledWith(slug);
      expect(result).toEqual(mockTenant);
    });

    it('should return null if tenant not found', async () => {
      const slug = 'non-existent-slug';
      mockFindBySlug.mockResolvedValue(null);

      await expect(service.findBySlug(slug)).rejects.toThrow(NotFoundException);
      expect(mockFindBySlug).toHaveBeenCalledWith(slug);
    });
  });

  describe('delete', () => {
    it('should delete a tenant if found', async () => {
      const id = mockTenant.id;
      mockFindById.mockResolvedValue(mockTenant);

      await service.delete(id);

      expect(mockFindById).toHaveBeenCalledWith(id);
      expect(mockDelete).toHaveBeenCalledWith(id);
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: id,
        action: AuditAction.DELETE,
        resourceType: 'tenant',
        resourceId: id,
      });
    });

    it('should throw NotFoundException if tenant not found', async () => {
      const id = '999e4567-e89b-12d3-a456-426614174000';
      mockFindById.mockResolvedValue(null);

      await expect(service.delete(id)).rejects.toThrow(NotFoundException);
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  describe('restore', () => {
    it('should restore a tenant if found', async () => {
      const id = mockTenant.id;
      mockFindById.mockResolvedValue(mockTenant);

      await service.restore(id);

      expect(mockFindById).toHaveBeenCalledWith(id);
      expect(mockRestore).toHaveBeenCalledWith(id);
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: mockTenant.id,
        action: AuditAction.UPDATE,
        resourceType: 'tenant',
        resourceId: mockTenant.id,
        metadata: { restored: true },
      });
    });

    it('should throw NotFoundException if tenant not found', async () => {
      const id = '999e4567-e89b-12d3-a456-426614174000';
      mockFindById.mockResolvedValue(null);

      await expect(service.restore(id)).rejects.toThrow(NotFoundException);
      expect(mockRestore).toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('should suspend an active tenant', async () => {
      const id = mockTenant.id;
      const suspended = { ...mockTenant, status: TenantStatus.SUSPENDED };

      mockFindById.mockResolvedValue({ ...mockTenant });
      mockUpdate.mockResolvedValue(suspended);

      const result = await service.updateStatus(id, TenantStatus.SUSPENDED);

      expect(mockFindById).toHaveBeenCalledWith(id);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: TenantStatus.SUSPENDED,
          deactivated_at: null,
        }),
      );
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: suspended.id,
        action: AuditAction.UPDATE,
        resourceType: 'tenant',
        resourceId: suspended.id,
        metadata: {
          status_change: {
            from: TenantStatus.ACTIVE,
            to: TenantStatus.SUSPENDED,
          },
        },
      });
      expect(mockPublish).toHaveBeenCalledWith(
        JOB_QUEUES.TENANT_STATUS_CHANGE,
        {
          tenantId: suspended.id,
          previousStatus: TenantStatus.ACTIVE,
          status: TenantStatus.SUSPENDED,
        },
      );
      expect(result).toEqual(suspended);
    });

    it('should deactivate an active tenant and stamp deactivated_at', async () => {
      const id = mockTenant.id;
      const deactivated = { ...mockTenant, status: TenantStatus.DEACTIVATED };

      mockFindById.mockResolvedValue({ ...mockTenant });
      mockUpdate.mockResolvedValue(deactivated);

      await service.updateStatus(id, TenantStatus.DEACTIVATED);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: TenantStatus.DEACTIVATED,
          deactivated_at: expect.any(Date),
        }),
      );
    });

    it('should reactivate a deactivated tenant and clear deactivated_at', async () => {
      const id = mockTenant.id;
      const deactivatedTenant = {
        ...mockTenant,
        status: TenantStatus.DEACTIVATED,
        deactivated_at: new Date(),
      };
      const reactivated = { ...mockTenant, status: TenantStatus.ACTIVE };

      mockFindById.mockResolvedValue(deactivatedTenant);
      mockUpdate.mockResolvedValue(reactivated);

      const result = await service.updateStatus(id, TenantStatus.ACTIVE);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: TenantStatus.ACTIVE,
          deactivated_at: null,
        }),
      );
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: reactivated.id,
        action: AuditAction.UPDATE,
        resourceType: 'tenant',
        resourceId: reactivated.id,
        metadata: {
          status_change: {
            from: TenantStatus.DEACTIVATED,
            to: TenantStatus.ACTIVE,
          },
        },
      });
      expect(mockPublish).toHaveBeenCalledWith(
        JOB_QUEUES.TENANT_STATUS_CHANGE,
        {
          tenantId: reactivated.id,
          previousStatus: TenantStatus.DEACTIVATED,
          status: TenantStatus.ACTIVE,
        },
      );
      expect(result).toEqual(reactivated);
    });

    it('should reject an invalid transition', async () => {
      mockFindById.mockResolvedValue({
        ...mockTenant,
        status: TenantStatus.PENDING_APPROVAL,
      });

      await expect(
        service.updateStatus(mockTenant.id, TenantStatus.ACTIVE),
      ).rejects.toThrow(ConflictException);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
      expect(mockPublish).not.toHaveBeenCalled();
    });

    it('should not fail the status update if publishing the job fails', async () => {
      const id = mockTenant.id;
      const suspended = { ...mockTenant, status: TenantStatus.SUSPENDED };

      mockFindById.mockResolvedValue({ ...mockTenant });
      mockUpdate.mockResolvedValue(suspended);
      mockPublish.mockRejectedValue(new Error('queue unavailable'));

      const result = await service.updateStatus(id, TenantStatus.SUSPENDED);

      expect(mockPublish).toHaveBeenCalled();
      expect(result).toEqual(suspended);
    });

    it('should reject a no-op transition to the same status', async () => {
      mockFindById.mockResolvedValue({ ...mockTenant });

      await expect(
        service.updateStatus(mockTenant.id, TenantStatus.ACTIVE),
      ).rejects.toThrow(ConflictException);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if tenant not found', async () => {
      const id = '999e4567-e89b-12d3-a456-426614174000';
      mockFindById.mockResolvedValue(null);

      await expect(
        service.updateStatus(id, TenantStatus.SUSPENDED),
      ).rejects.toThrow(NotFoundException);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
