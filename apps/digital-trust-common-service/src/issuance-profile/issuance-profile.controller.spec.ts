import { JwtGuard, ScopeGuard, TenantGuard, type AuthContext } from '@app/auth';
import { CanActivate } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { CredentialDefinitionFormat } from '../credential-definition/credential-definition.entity';
import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';
import { TenantStatus } from '../tenant/tenant.entity';

import { CreateIssuanceProfileDto } from './dto/create-issuance-profile.dto';
import { IssuanceProfileResponseDto } from './dto/issuance-profile-response.dto';
import { UpdateIssuanceProfileDto } from './dto/update-issuance-profile.dto';
import { IssuanceProfileController } from './issuance-profile.controller';
import {
  IssuanceProfile,
  IssuanceProfileProtocolHint,
  IssuanceProfileStatus,
} from './issuance-profile.entity';
import { IssuanceProfileService } from './issuance-profile.service';

class AllowGuard implements CanActivate {
  public canActivate(): boolean {
    return true;
  }
}

describe('IssuanceProfileController', () => {
  let controller: IssuanceProfileController;

  let mockCreate: jest.Mock;
  let mockFindById: jest.Mock;
  let mockFindByTenantId: jest.Mock;
  let mockUpdate: jest.Mock;
  let mockPublish: jest.Mock;
  let mockDeprecate: jest.Mock;

  const auth: AuthContext = {
    sub: 'user-1',
    tokenType: 'user',
    clientId: 'spa',
    tenantId: '123e4567-e89b-12d3-a456-426614174001',
    roles: [],
    scope: 'tenants:admin',
    scopes: ['tenants:admin'],
    iss: 'http://localhost/oidc',
    aud: 'http://localhost/oidc',
    exp: 9_999_999_999,
    iat: 1,
  };

  const mockProfile: IssuanceProfile = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    tenantId: '123e4567-e89b-12d3-a456-426614174001',
    name: 'drivers-license',
    version: '1.0',
    description: undefined,
    credentialDefinitionId: '123e4567-e89b-12d3-a456-426614174002',
    format: CredentialDefinitionFormat.ANONCREDS,
    connectorId: '123e4567-e89b-12d3-a456-426614174003',
    attributeSchema: { given_name: { type: 'string', required: true } },
    defaults: undefined,
    display: undefined,
    metadata: {},
    protocolHint: IssuanceProfileProtocolHint.AUTO,
    status: IssuanceProfileStatus.DRAFT,
    createdAt: new Date(),
    updatedAt: new Date(),
    tenant: {
      id: '123e4567-e89b-12d3-a456-426614174001',
      name: 'Test Tenant',
      slug: 'test-tenant',
      description: 'A test tenant',
      status: TenantStatus.ACTIVE,
      config: {},
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: new Date(),
    },
  } as IssuanceProfile;

  beforeEach(async () => {
    mockCreate = jest.fn();
    mockFindById = jest.fn();
    mockFindByTenantId = jest.fn();
    mockUpdate = jest.fn();
    mockPublish = jest.fn();
    mockDeprecate = jest.fn();

    const mockService = {
      create: mockCreate,
      findById: mockFindById,
      findByTenantId: mockFindByTenantId,
      update: mockUpdate,
      publish: mockPublish,
      deprecate: mockDeprecate,
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IssuanceProfileController],
      providers: [
        {
          provide: IssuanceProfileService,
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
      .overrideGuard(TenantStatusGuard)
      .useClass(AllowGuard)
      .overrideGuard(TenantTierRateLimitGuard)
      .useClass(AllowGuard)
      .compile();

    controller = module.get<IssuanceProfileController>(
      IssuanceProfileController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /tenants/:tenantId/profiles/issuance', () => {
    it('creates a new issuance profile', async () => {
      const tenantId = mockProfile.tenantId;
      const dto: CreateIssuanceProfileDto = {
        name: mockProfile.name,
        version: mockProfile.version,
        credentialDefinitionId: mockProfile.credentialDefinitionId,
        attributeSchema: mockProfile.attributeSchema,
      };

      mockCreate.mockResolvedValue(mockProfile);

      const result = await controller.create(tenantId, dto, auth);

      expect(mockCreate).toHaveBeenCalledWith(tenantId, dto, auth);
      expect(result).toEqual(
        IssuanceProfileResponseDto.fromEntity(mockProfile),
      );
    });
  });

  describe('GET /tenants/:tenantId/profiles/issuance', () => {
    it('lists profiles with the provided filters', async () => {
      const tenantId = mockProfile.tenantId;
      mockFindByTenantId.mockResolvedValue({
        data: [mockProfile],
        pagination: { next_cursor: null, has_more: false },
      });

      const result = await controller.findByTenantId(tenantId, {
        status: IssuanceProfileStatus.DRAFT,
        format: undefined,
        name: undefined,
        cursor: undefined,
        limit: undefined,
      });

      expect(mockFindByTenantId).toHaveBeenCalledWith(
        tenantId,
        {
          status: IssuanceProfileStatus.DRAFT,
          format: undefined,
          name: undefined,
        },
        { limit: undefined, cursor: undefined },
      );
      expect(result).toEqual({
        data: [IssuanceProfileResponseDto.fromEntity(mockProfile)],
        pagination: { nextCursor: null, hasMore: false },
      });
    });

    it('passes cursor and limit through to the service', async () => {
      const tenantId = mockProfile.tenantId;
      mockFindByTenantId.mockResolvedValue({
        data: [],
        pagination: { next_cursor: 'next-cursor', has_more: true },
      });

      const result = await controller.findByTenantId(tenantId, {
        status: undefined,
        format: undefined,
        name: undefined,
        cursor: 'prev-cursor',
        limit: 5,
      });

      expect(mockFindByTenantId).toHaveBeenCalledWith(
        tenantId,
        { status: undefined, format: undefined, name: undefined },
        { limit: 5, cursor: 'prev-cursor' },
      );
      expect(result).toEqual({
        data: [],
        pagination: { nextCursor: 'next-cursor', hasMore: true },
      });
    });
  });

  describe('GET /tenants/:tenantId/profiles/issuance/:id', () => {
    it('returns a profile by id', async () => {
      const tenantId = mockProfile.tenantId;
      const id = mockProfile.id;
      mockFindById.mockResolvedValue(mockProfile);

      const result = await controller.findById(tenantId, id, auth);

      expect(mockFindById).toHaveBeenCalledWith(tenantId, id, auth);
      expect(result).toEqual(
        IssuanceProfileResponseDto.fromEntity(mockProfile),
      );
    });
  });

  describe('PATCH /tenants/:tenantId/profiles/issuance/:id', () => {
    it('updates a profile', async () => {
      const tenantId = mockProfile.tenantId;
      const id = mockProfile.id;
      const dto: UpdateIssuanceProfileDto = { description: 'Updated' };
      const updated = { ...mockProfile, description: 'Updated' };

      mockUpdate.mockResolvedValue(updated);

      const result = await controller.update(tenantId, id, dto, auth);

      expect(mockUpdate).toHaveBeenCalledWith(tenantId, id, dto, auth);
      expect(result).toEqual(IssuanceProfileResponseDto.fromEntity(updated));
    });
  });

  describe('POST /tenants/:tenantId/profiles/issuance/:id/publish', () => {
    it('publishes a profile', async () => {
      const tenantId = mockProfile.tenantId;
      const id = mockProfile.id;
      const published = {
        ...mockProfile,
        status: IssuanceProfileStatus.PUBLISHED,
      };

      mockPublish.mockResolvedValue(published);

      const result = await controller.publish(tenantId, id, auth);

      expect(mockPublish).toHaveBeenCalledWith(tenantId, id, auth);
      expect(result).toEqual(IssuanceProfileResponseDto.fromEntity(published));
    });
  });

  describe('POST /tenants/:tenantId/profiles/issuance/:id/deprecate', () => {
    it('deprecates a profile', async () => {
      const tenantId = mockProfile.tenantId;
      const id = mockProfile.id;
      const deprecated = {
        ...mockProfile,
        status: IssuanceProfileStatus.DEPRECATED,
      };

      mockDeprecate.mockResolvedValue(deprecated);

      const result = await controller.deprecate(tenantId, id, auth);

      expect(mockDeprecate).toHaveBeenCalledWith(tenantId, id, auth);
      expect(result).toEqual(IssuanceProfileResponseDto.fromEntity(deprecated));
    });
  });
});
