import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';

import { CreateTenantDto } from './dto/create-tenant.dto';
import { Tenant, TenantStatus } from './tenant.entity';
import { TenantRepository } from './tenant.repository';
import { TenantService } from './tenant.service';

describe('TenantService', () => {
  let service: TenantService;
  let mockCreate: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockFindAll: jest.Mock;
  let mockFindById: jest.Mock;
  let mockFindBySlug: jest.Mock;
  let mockDelete: jest.Mock;
  let mockRestore: jest.Mock;
  let mockEmit: jest.Mock;

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
    mockFindAll = jest.fn();
    mockFindById = jest.fn();
    mockFindBySlug = jest.fn();
    mockDelete = jest.fn();
    mockRestore = jest.fn();
    mockEmit = jest.fn().mockResolvedValue(undefined);

    const mockRepository = {
      create: mockCreate,
      update: mockUpdate,
      findAll: mockFindAll,
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
      };

      mockFindBySlug.mockResolvedValue(null);
      mockCreate.mockReturnValue(mockTenant);
      mockUpdate.mockResolvedValue(mockTenant);

      const result = await service.create(dto, { roles: ['platform-admin'] });

      expect(mockFindBySlug).toHaveBeenCalledWith(dto.slug, true);
      expect(mockCreate).toHaveBeenCalledWith({
        ...dto,
        status: 'active',
      });
      expect(mockUpdate).toHaveBeenCalledWith(mockTenant);
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: mockTenant.id,
        action: AuditAction.CREATE,
        resourceType: 'tenant',
        resourceId: mockTenant.id,
      });
      expect(result).toEqual(mockTenant);
    });

    it('should create a pending-approval tenant for self-service requests', async () => {
      const dto: CreateTenantDto = {
        name: 'New Tenant',
        slug: 'new-tenant',
        description: 'A new tenant',
        config: {},
      };

      mockFindBySlug.mockResolvedValue(null);
      mockCreate.mockReturnValue({ ...mockTenant, status: 'pending_approval' });
      mockUpdate.mockResolvedValue({
        ...mockTenant,
        status: 'pending_approval',
      });

      const result = await service.create(dto, { roles: [] });

      expect(mockCreate).toHaveBeenCalledWith({
        ...dto,
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
      };

      mockFindBySlug.mockResolvedValue({
        ...mockTenant,
        deleted_at: new Date(),
      });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
      expect(mockFindBySlug).toHaveBeenCalledWith(dto.slug, true);
      expect(mockCreate).not.toHaveBeenCalled();
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

  describe('findAll', () => {
    it('should return all tenants', async () => {
      const tenants = [mockTenant];
      mockFindAll.mockResolvedValue(tenants);

      const result = await service.findAll();

      expect(mockFindAll).toHaveBeenCalled();
      expect(result).toEqual(tenants);
    });

    it('should return empty array if no tenants exist', async () => {
      mockFindAll.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
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
});
