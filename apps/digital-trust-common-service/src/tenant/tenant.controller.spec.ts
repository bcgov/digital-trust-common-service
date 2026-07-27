import { Test, TestingModule } from '@nestjs/testing';

import { CreateTenantDto } from './dto/create-tenant.dto';
import { TenantController } from './tenant.controller';
import { Tenant, TenantStatus } from './tenant.entity';
import { TenantService } from './tenant.service';

describe('TenantController', () => {
  let controller: TenantController;

  let mockCreate: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockFindAll: jest.Mock;
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
    mockFindAll = jest.fn();
    mockFindById = jest.fn();
    mockFindBySlug = jest.fn();
    mockDelete = jest.fn();
    mockRestore = jest.fn();

    const mockService = {
      create: mockCreate,
      update: mockUpdate,
      findAll: mockFindAll,
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
    }).compile();

    controller = module.get<TenantController>(TenantController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /tenants', () => {
    it('should create a new tenant', async () => {
      const dto: CreateTenantDto = {
        name: 'New Tenant',
        slug: 'new-tenant',
        description: 'A new tenant',
        config: {},
      };

      mockCreate.mockResolvedValue(mockTenant);

      const result = await controller.create(dto);

      expect(mockCreate).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockTenant);
    });
  });

  describe('PUT /tenants/:id', () => {
    it('should update a tenant', async () => {
      const id = mockTenant.id;
      const dto: Partial<CreateTenantDto> = { name: 'Updated Name' };
      const updatedTenant = { ...mockTenant, ...dto };

      mockUpdate.mockResolvedValue(updatedTenant);

      const result = await controller.update(dto, id);

      expect(mockUpdate).toHaveBeenCalledWith(id, dto);
      expect(result).toEqual(updatedTenant);
    });
  });

  describe('GET /tenants', () => {
    it('should return all tenants', async () => {
      const tenants = [mockTenant];
      mockFindAll.mockResolvedValue(tenants);

      const result = await controller.findAll();

      expect(mockFindAll).toHaveBeenCalled();
      expect(result).toEqual(tenants);
    });

    it('should return empty array if no tenants exist', async () => {
      mockFindAll.mockResolvedValue([]);

      const result = await controller.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('GET /tenants/:id', () => {
    it('should return a tenant by id', async () => {
      const id = mockTenant.id;
      mockFindById.mockResolvedValue(mockTenant);

      const result = await controller.findById(id);

      expect(mockFindById).toHaveBeenCalledWith(id);
      expect(result).toEqual(mockTenant);
    });

    it('should return null if tenant not found', async () => {
      const id = '999e4567-e89b-12d3-a456-426614174000';
      mockFindById.mockResolvedValue(null);

      const result = await controller.findById(id);

      expect(result).toBeNull();
    });
  });

  describe('GET /tenants/slug/:slug', () => {
    it('should return a tenant by slug', async () => {
      const slug = mockTenant.slug;
      mockFindBySlug.mockResolvedValue(mockTenant);

      const result = await controller.findBySlug(slug);

      expect(mockFindBySlug).toHaveBeenCalledWith(slug);
      expect(result).toEqual(mockTenant);
    });

    it('should return null if tenant not found', async () => {
      const slug = 'non-existent-slug';
      mockFindBySlug.mockResolvedValue(null);

      const result = await controller.findBySlug(slug);

      expect(result).toBeNull();
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
