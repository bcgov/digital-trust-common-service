import { AuthContext } from '@app/auth';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { QueryFailedError } from 'typeorm';

import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import {
  IssuanceProfile,
  IssuanceProfileProtocolHint,
  IssuanceProfileStatus,
} from '../issuance-profile/issuance-profile.entity';
import { IssuanceProfileService } from '../issuance-profile/issuance-profile.service';

import { CreateVerificationProfileDto } from './dto/create-verification-profile.dto';
import { UpdateVerificationProfileDto } from './dto/update-verification-profile.dto';
import { VerificationPredicateCondition } from './dto/verification-predicate.dto';
import {
  VerificationProfile,
  VerificationProfileProtocolHint,
  VerificationProfileStatus,
} from './verification-profile.entity';
import { VerificationProfileRepository } from './verification-profile.repository';
import { VerificationProfileService } from './verification-profile.service';

describe('VerificationProfileService', () => {
  let service: VerificationProfileService;
  let mockCreate: jest.Mock;
  let mockFindById: jest.Mock;
  let mockFindByNameAndVersion: jest.Mock;
  let mockFindPage: jest.Mock;
  let mockSave: jest.Mock;
  let mockTransitionStatus: jest.Mock;
  let mockEmit: jest.Mock;
  let mockIssuanceFindById: jest.Mock;

  const tenantId = '123e4567-e89b-12d3-a456-426614174001';

  const mockIssuanceProfile: IssuanceProfile = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    tenantId,
    name: 'person-credential',
    version: '1.0',
    description: undefined,
    credentialDefinitionId: '123e4567-e89b-12d3-a456-426614174002',
    format: 'anoncreds' as IssuanceProfile['format'],
    connectorId: undefined,
    attributeSchema: {
      given_names: { type: 'string' },
      birthdate_dateint: { type: 'number' },
    },
    defaults: undefined,
    display: undefined,
    metadata: {},
    protocolHint: IssuanceProfileProtocolHint.AUTO,
    status: IssuanceProfileStatus.PUBLISHED,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as IssuanceProfile;

  const mockProfile: VerificationProfile = {
    id: '123e4567-e89b-12d3-a456-426614174003',
    tenantId,
    issuanceProfileId: mockIssuanceProfile.id,
    name: 'age-verification',
    version: '1.0',
    description: undefined,
    presentationDefinition: {
      id: 'age-over-18',
      input_descriptors: [
        {
          id: 'person_credential',
          constraints: {
            fields: [{ path: ['$.credentialSubject.given_names'] }],
          },
        },
      ],
    },
    requestedAttributes: ['given_names'],
    predicates: undefined,
    metadata: {},
    isPublic: false,
    protocolHint: VerificationProfileProtocolHint.AUTO,
    status: VerificationProfileStatus.DRAFT,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as VerificationProfile;

  const auth = {
    sub: 'user-1',
    tokenType: 'user' as const,
    clientId: 'spa',
    tenantId,
    roles: [] as string[],
    scope: 'tenants:admin',
    scopes: ['tenants:admin'],
    iss: 'http://localhost/oidc',
    aud: 'http://localhost/oidc',
    exp: 9_999_999_999,
    iat: 1,
  } satisfies AuthContext;

  beforeEach(async () => {
    mockCreate = jest.fn();
    mockFindById = jest.fn();
    mockFindByNameAndVersion = jest.fn();
    mockFindPage = jest.fn();
    mockSave = jest.fn();
    mockTransitionStatus = jest.fn().mockResolvedValue(true);
    mockEmit = jest.fn().mockResolvedValue(undefined);
    mockIssuanceFindById = jest.fn().mockResolvedValue(mockIssuanceProfile);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationProfileService,
        {
          provide: VerificationProfileRepository,
          useValue: {
            create: mockCreate,
            findById: mockFindById,
            findByNameAndVersion: mockFindByNameAndVersion,
            findPage: mockFindPage,
            save: mockSave,
            transitionStatus: mockTransitionStatus,
          },
        },
        {
          provide: IssuanceProfileService,
          useValue: { findById: mockIssuanceFindById },
        },
        {
          provide: DomainAuditService,
          useValue: { emit: mockEmit },
        },
      ],
    }).compile();

    service = module.get<VerificationProfileService>(
      VerificationProfileService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const dto: CreateVerificationProfileDto = {
      name: 'age-verification',
      version: '1.0',
      issuanceProfileId: mockIssuanceProfile.id,
      presentationDefinition: mockProfile.presentationDefinition,
    };

    it('creates a profile in draft status with derived requested_attributes', async () => {
      mockFindByNameAndVersion.mockResolvedValue(null);
      mockCreate.mockResolvedValue(mockProfile);

      const result = await service.create(tenantId, dto, auth);

      expect(mockIssuanceFindById).toHaveBeenCalledWith(
        tenantId,
        dto.issuanceProfileId,
        auth,
      );
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          issuanceProfileId: mockIssuanceProfile.id,
          name: dto.name,
          version: dto.version,
          presentationDefinition: dto.presentationDefinition,
          requestedAttributes: ['given_names'],
          isPublic: false,
        }),
      );
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: mockProfile.tenantId,
        action: AuditAction.CREATE,
        resourceType: 'verification_profile',
        resourceId: mockProfile.id,
      });
      expect(result).toBe(mockProfile);
    });

    it('rejects when the issuance profile is not published', async () => {
      mockIssuanceFindById.mockResolvedValue({
        ...mockIssuanceProfile,
        status: IssuanceProfileStatus.DRAFT,
      });

      await expect(service.create(tenantId, dto, auth)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('rejects requested attributes not present in attribute_schema', async () => {
      await expect(
        service.create(
          tenantId,
          {
            ...dto,
            presentationDefinition: {
              id: 'age-over-18',
              input_descriptors: [
                {
                  id: 'person_credential',
                  constraints: {
                    fields: [{ path: ['$.credentialSubject.unknown_attr'] }],
                  },
                },
              ],
            },
          },
          auth,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('rejects a presentation_definition without input_descriptors', async () => {
      await expect(
        service.create(
          tenantId,
          { ...dto, presentationDefinition: { id: 'age-over-18' } },
          auth,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects predicates referencing an unknown attribute', async () => {
      await expect(
        service.create(
          tenantId,
          {
            ...dto,
            predicates: [
              {
                attribute: 'unknown_attr',
                condition: VerificationPredicateCondition.GREATER_THAN_OR_EQUAL,
                value: '19',
              },
            ],
          },
          auth,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a non-numeric predicate value for a numeric attribute', async () => {
      await expect(
        service.create(
          tenantId,
          {
            ...dto,
            predicates: [
              {
                attribute: 'birthdate_dateint',
                condition: VerificationPredicateCondition.GREATER_THAN_OR_EQUAL,
                value: 'not-a-number',
              },
            ],
          },
          auth,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a numeric predicate value for a numeric attribute', async () => {
      mockFindByNameAndVersion.mockResolvedValue(null);
      mockCreate.mockResolvedValue(mockProfile);

      await expect(
        service.create(
          tenantId,
          {
            ...dto,
            predicates: [
              {
                attribute: 'birthdate_dateint',
                condition: VerificationPredicateCondition.GREATER_THAN_OR_EQUAL,
                value: '19',
              },
            ],
          },
          auth,
        ),
      ).resolves.toBe(mockProfile);
    });

    it('throws 409 when the name/version already exists', async () => {
      mockFindByNameAndVersion.mockResolvedValue(mockProfile);

      await expect(service.create(tenantId, dto, auth)).rejects.toThrow(
        ConflictException,
      );
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('translates a losing unique-constraint race into a 409', async () => {
      mockFindByNameAndVersion.mockResolvedValue(null);
      const driverError = {
        code: '23505',
        constraint: 'uq_verification_profile_tenant_name_version',
      };
      mockCreate.mockRejectedValue(
        Object.assign(
          new QueryFailedError('insert', [], new Error('duplicate')),
          { driverError },
        ),
      );

      await expect(service.create(tenantId, dto, auth)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findById', () => {
    it('returns a profile scoped to the tenant', async () => {
      mockFindById.mockResolvedValue(mockProfile);

      await expect(
        service.findById(tenantId, mockProfile.id, auth),
      ).resolves.toBe(mockProfile);
    });

    it('throws 404 when the profile belongs to another tenant', async () => {
      mockFindById.mockResolvedValue({ ...mockProfile, tenantId: 'other' });

      await expect(
        service.findById(tenantId, mockProfile.id, auth),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 404 when the profile does not exist', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(
        service.findById(tenantId, mockProfile.id, auth),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByTenantId', () => {
    it('paginates and encodes the next cursor', async () => {
      mockFindPage.mockResolvedValue({
        items: [mockProfile],
        nextCursor: { createdAt: '2024-01-01T00:00:00.000Z', id: 'vp-1' },
        hasMore: true,
      });

      const result = await service.findByTenantId(tenantId, {});

      expect(mockFindPage).toHaveBeenCalledWith(
        tenantId,
        {},
        { limit: 20, cursor: null },
      );
      expect(result.data).toEqual([mockProfile]);
      expect(result.pagination.has_more).toBe(true);
      expect(typeof result.pagination.next_cursor).toBe('string');
    });
  });

  describe('update', () => {
    it('updates description on a draft profile', async () => {
      mockFindById.mockResolvedValue({ ...mockProfile });
      mockSave.mockImplementation((p: VerificationProfile) =>
        Promise.resolve(p),
      );

      const dto: UpdateVerificationProfileDto = { description: 'Updated' };
      const result = await service.update(tenantId, mockProfile.id, dto, auth);

      expect(result.description).toBe('Updated');
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.UPDATE }),
      );
    });

    it('re-derives requested_attributes when presentation_definition changes', async () => {
      mockFindById.mockResolvedValue({ ...mockProfile });
      mockSave.mockImplementation((p: VerificationProfile) =>
        Promise.resolve(p),
      );

      const dto: UpdateVerificationProfileDto = {
        presentationDefinition: {
          id: 'age-over-18',
          input_descriptors: [
            {
              id: 'person_credential',
              constraints: {
                fields: [{ path: ['$.credentialSubject.given_names'] }],
              },
            },
          ],
        },
      };

      const result = await service.update(tenantId, mockProfile.id, dto, auth);

      expect(mockIssuanceFindById).toHaveBeenCalledWith(
        tenantId,
        mockProfile.issuanceProfileId,
        auth,
      );
      expect(result.requestedAttributes).toEqual(['given_names']);
    });

    it('rejects updating a published profile', async () => {
      mockFindById.mockResolvedValue({
        ...mockProfile,
        status: VerificationProfileStatus.PUBLISHED,
      });

      await expect(
        service.update(tenantId, mockProfile.id, { description: 'x' }, auth),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('publish', () => {
    it('publishes a draft profile', async () => {
      mockFindById
        .mockResolvedValueOnce({ ...mockProfile })
        .mockResolvedValueOnce({
          ...mockProfile,
          status: VerificationProfileStatus.PUBLISHED,
        });

      const result = await service.publish(tenantId, mockProfile.id, auth);

      expect(mockTransitionStatus).toHaveBeenCalledWith(
        tenantId,
        mockProfile.id,
        VerificationProfileStatus.DRAFT,
        VerificationProfileStatus.PUBLISHED,
      );
      expect(result.status).toBe(VerificationProfileStatus.PUBLISHED);
    });

    it('rejects publishing a non-draft profile', async () => {
      mockFindById.mockResolvedValue({
        ...mockProfile,
        status: VerificationProfileStatus.PUBLISHED,
      });

      await expect(
        service.publish(tenantId, mockProfile.id, auth),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects when the transition loses the race', async () => {
      mockFindById.mockResolvedValue({ ...mockProfile });
      mockTransitionStatus.mockResolvedValue(false);

      await expect(
        service.publish(tenantId, mockProfile.id, auth),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('deprecate', () => {
    it('deprecates a published profile', async () => {
      const published = {
        ...mockProfile,
        status: VerificationProfileStatus.PUBLISHED,
      };
      mockFindById.mockResolvedValueOnce(published).mockResolvedValueOnce({
        ...published,
        status: VerificationProfileStatus.DEPRECATED,
      });

      const result = await service.deprecate(tenantId, mockProfile.id, auth);

      expect(mockTransitionStatus).toHaveBeenCalledWith(
        tenantId,
        mockProfile.id,
        VerificationProfileStatus.PUBLISHED,
        VerificationProfileStatus.DEPRECATED,
      );
      expect(result.status).toBe(VerificationProfileStatus.DEPRECATED);
    });

    it('rejects deprecating a non-published profile', async () => {
      mockFindById.mockResolvedValue({ ...mockProfile });

      await expect(
        service.deprecate(tenantId, mockProfile.id, auth),
      ).rejects.toThrow(ConflictException);
    });
  });
});
