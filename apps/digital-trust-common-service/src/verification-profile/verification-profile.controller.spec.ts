import { JwtGuard, ScopeGuard, TenantGuard, type AuthContext } from '@app/auth';
import { CanActivate } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import { CreateVerificationProfileDto } from './dto/create-verification-profile.dto';
import { UpdateVerificationProfileDto } from './dto/update-verification-profile.dto';
import { VerificationProfileResponseDto } from './dto/verification-profile-response.dto';
import { VerificationProfileController } from './verification-profile.controller';
import {
  VerificationProfile,
  VerificationProfileProtocolHint,
  VerificationProfileStatus,
} from './verification-profile.entity';
import { VerificationProfileService } from './verification-profile.service';

class AllowGuard implements CanActivate {
  public canActivate(): boolean {
    return true;
  }
}

describe('VerificationProfileController', () => {
  let controller: VerificationProfileController;

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

  const mockProfile: VerificationProfile = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    tenantId: '123e4567-e89b-12d3-a456-426614174001',
    issuanceProfileId: '123e4567-e89b-12d3-a456-426614174002',
    name: 'age-verification',
    version: '1.0',
    description: undefined,
    presentationDefinition: { id: 'age-over-18', input_descriptors: [] },
    requestedAttributes: ['given_names'],
    predicates: undefined,
    metadata: {},
    isPublic: false,
    protocolHint: VerificationProfileProtocolHint.AUTO,
    status: VerificationProfileStatus.DRAFT,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as VerificationProfile;

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
      controllers: [VerificationProfileController],
      providers: [
        {
          provide: VerificationProfileService,
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

    controller = module.get<VerificationProfileController>(
      VerificationProfileController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /tenants/:tenantId/profiles/verification', () => {
    it('creates a new verification profile', async () => {
      const tenantId = mockProfile.tenantId;
      const dto: CreateVerificationProfileDto = {
        name: mockProfile.name,
        version: mockProfile.version,
        issuanceProfileId: mockProfile.issuanceProfileId,
        presentationDefinition: mockProfile.presentationDefinition,
      };

      mockCreate.mockResolvedValue(mockProfile);

      const result = await controller.create(tenantId, dto, auth);

      expect(mockCreate).toHaveBeenCalledWith(tenantId, dto, auth);
      expect(result).toEqual(
        VerificationProfileResponseDto.fromEntity(mockProfile),
      );
    });
  });

  describe('GET /tenants/:tenantId/profiles/verification', () => {
    it('lists profiles with the provided filters', async () => {
      const tenantId = mockProfile.tenantId;
      mockFindByTenantId.mockResolvedValue({
        data: [mockProfile],
        pagination: { next_cursor: null, has_more: false },
      });

      const result = await controller.findByTenantId(tenantId, {
        status: VerificationProfileStatus.DRAFT,
        issuanceProfileId: undefined,
        isPublic: undefined,
        cursor: undefined,
        limit: undefined,
      });

      expect(mockFindByTenantId).toHaveBeenCalledWith(
        tenantId,
        {
          status: VerificationProfileStatus.DRAFT,
          issuanceProfileId: undefined,
          isPublic: undefined,
        },
        { limit: undefined, cursor: undefined },
      );
      expect(result).toEqual({
        data: [VerificationProfileResponseDto.fromEntity(mockProfile)],
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
        issuanceProfileId: mockProfile.issuanceProfileId,
        isPublic: true,
        cursor: 'prev-cursor',
        limit: 5,
      });

      expect(mockFindByTenantId).toHaveBeenCalledWith(
        tenantId,
        {
          status: undefined,
          issuanceProfileId: mockProfile.issuanceProfileId,
          isPublic: true,
        },
        { limit: 5, cursor: 'prev-cursor' },
      );
      expect(result).toEqual({
        data: [],
        pagination: { nextCursor: 'next-cursor', hasMore: true },
      });
    });
  });

  describe('GET /tenants/:tenantId/profiles/verification/:id', () => {
    it('returns a profile by id', async () => {
      const tenantId = mockProfile.tenantId;
      const id = mockProfile.id;
      mockFindById.mockResolvedValue(mockProfile);

      const result = await controller.findById(tenantId, id, auth);

      expect(mockFindById).toHaveBeenCalledWith(tenantId, id, auth);
      expect(result).toEqual(
        VerificationProfileResponseDto.fromEntity(mockProfile),
      );
    });
  });

  describe('PATCH /tenants/:tenantId/profiles/verification/:id', () => {
    it('updates a profile', async () => {
      const tenantId = mockProfile.tenantId;
      const id = mockProfile.id;
      const dto: UpdateVerificationProfileDto = { description: 'Updated' };
      const updated = { ...mockProfile, description: 'Updated' };

      mockUpdate.mockResolvedValue(updated);

      const result = await controller.update(tenantId, id, dto, auth);

      expect(mockUpdate).toHaveBeenCalledWith(tenantId, id, dto, auth);
      expect(result).toEqual(
        VerificationProfileResponseDto.fromEntity(updated),
      );
    });
  });

  describe('POST /tenants/:tenantId/profiles/verification/:id/publish', () => {
    it('publishes a profile', async () => {
      const tenantId = mockProfile.tenantId;
      const id = mockProfile.id;
      const published = {
        ...mockProfile,
        status: VerificationProfileStatus.PUBLISHED,
      };

      mockPublish.mockResolvedValue(published);

      const result = await controller.publish(tenantId, id, auth);

      expect(mockPublish).toHaveBeenCalledWith(tenantId, id, auth);
      expect(result).toEqual(
        VerificationProfileResponseDto.fromEntity(published),
      );
    });
  });

  describe('POST /tenants/:tenantId/profiles/verification/:id/deprecate', () => {
    it('deprecates a profile', async () => {
      const tenantId = mockProfile.tenantId;
      const id = mockProfile.id;
      const deprecated = {
        ...mockProfile,
        status: VerificationProfileStatus.DEPRECATED,
      };

      mockDeprecate.mockResolvedValue(deprecated);

      const result = await controller.deprecate(tenantId, id, auth);

      expect(mockDeprecate).toHaveBeenCalledWith(tenantId, id, auth);
      expect(result).toEqual(
        VerificationProfileResponseDto.fromEntity(deprecated),
      );
    });
  });
});
