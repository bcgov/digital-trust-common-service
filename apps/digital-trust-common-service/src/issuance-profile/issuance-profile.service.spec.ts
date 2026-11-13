import {
  AdapterError,
  ConnectorUnavailableError,
  CredentialFormat,
  FormatNotSupportedError,
} from '@app/credential-ports';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { encodeCursor } from '../common/cursor-pagination';
import {
  CredentialDefinition,
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
  CredentialDefinitionStatus,
} from '../credential-definition/credential-definition.entity';
import { CredentialDefinitionService } from '../credential-definition/credential-definition.service';
import { TenantStatus } from '../tenant/tenant.entity';

import { CreateIssuanceProfileDto } from './dto/create-issuance-profile.dto';
import { UpdateIssuanceProfileDto } from './dto/update-issuance-profile.dto';
import {
  IssuanceProfile,
  IssuanceProfileStatus,
} from './issuance-profile.entity';
import {
  IssuanceProfileDeleteResult,
  IssuanceProfileRepository,
} from './issuance-profile.repository';
import { IssuanceProfileService } from './issuance-profile.service';

describe('IssuanceProfileService', () => {
  let service: IssuanceProfileService;
  let mockCreate: jest.Mock;
  let mockFindById: jest.Mock;
  let mockFindByNameAndVersion: jest.Mock;
  let mockFindPage: jest.Mock;
  let mockFindUsedProfileIds: jest.Mock;
  let mockSave: jest.Mock;
  let mockEmit: jest.Mock;
  let mockCredentialDefinitionFindById: jest.Mock;
  let mockResolve: jest.Mock;
  let mockTransitionStatus: jest.Mock;
  let mockGetClaimsValidationSchema: jest.Mock;
  const manager = {} as EntityManager;
  let mockDeleteIfUnused: jest.Mock;

  const tenantId = '123e4567-e89b-12d3-a456-426614174001';

  const mockCredentialDefinition: CredentialDefinition = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    tenantId,
    name: 'Test Credential',
    format: CredentialDefinitionFormat.ANONCREDS,
    schemaDefinition: {
      attr_names: ['given_name', 'family_name'],
      schema_name: 'driver-license',
      schema_version: '1.0',
    },
    externalId: 'external-123',
    connectorId: '123e4567-e89b-12d3-a456-426614174002',
    registrationState: 'ready',
    connectorType: CredentialDefinitionConnectorType.TRACTION,
    version: '1.0',
    status: CredentialDefinitionStatus.PUBLISHED,
    isActive: true,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    tenant: {
      id: tenantId,
      name: 'Test Tenant',
      slug: 'test-tenant',
      description: 'A test tenant',
      status: TenantStatus.ACTIVE,
      config: {},
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: new Date(),
    },
  };

  const mockConnectorId = '123e4567-e89b-12d3-a456-426614174002';

  const mockProfile: IssuanceProfile = {
    id: '123e4567-e89b-12d3-a456-426614174003',
    tenantId,
    name: 'drivers-license',
    version: '1.0',
    description: undefined,
    credentialDefinitionId: mockCredentialDefinition.id,
    credentialDefinition: mockCredentialDefinition,
    claims: { required: ['given_name'], properties: {} },
    display: undefined,
    metadata: {},
    delivery: { protocol: 'didcomm-v1' },
    status: IssuanceProfileStatus.DRAFT,
    createdAt: new Date(),
    updatedAt: new Date(),
    tenant: mockCredentialDefinition.tenant,
  };

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
  };

  describe('remove', () => {
    it('deletes an unused profile and emits its audit event', async () => {
      mockFindById.mockResolvedValue(mockProfile);
      await service.remove(tenantId, mockProfile.id, auth);
      expect(mockDeleteIfUnused).toHaveBeenCalledWith(tenantId, mockProfile.id);
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId,
        action: AuditAction.DELETE,
        resourceType: 'issuance_profile',
        resourceId: mockProfile.id,
      });
    });

    it.each([
      IssuanceProfileDeleteResult.USED,
      IssuanceProfileDeleteResult.NOT_FOUND,
    ])('rejects %s without emitting an audit event', async (result) => {
      mockFindById.mockResolvedValue(mockProfile);
      mockDeleteIfUnused.mockResolvedValue(result);
      await expect(
        service.remove(tenantId, mockProfile.id, auth),
      ).rejects.toBeInstanceOf(
        result === IssuanceProfileDeleteResult.USED
          ? ConflictException
          : NotFoundException,
      );
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('does not delete another tenant profile', async () => {
      mockFindById.mockResolvedValue({
        ...mockProfile,
        tenantId: 'other-tenant',
      });
      await expect(
        service.remove(tenantId, mockProfile.id, auth),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockDeleteIfUnused).not.toHaveBeenCalled();
    });

    it('does not delete when the auth tenant differs', async () => {
      mockFindById.mockResolvedValue(mockProfile);
      await expect(
        service.remove(tenantId, mockProfile.id, {
          ...auth,
          tenantId: 'other-tenant',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(mockDeleteIfUnused).not.toHaveBeenCalled();
    });
  });

  beforeEach(async () => {
    mockCreate = jest.fn();
    mockFindById = jest.fn();
    mockFindByNameAndVersion = jest.fn();
    mockFindPage = jest.fn();
    mockFindUsedProfileIds = jest.fn().mockResolvedValue(new Set<string>());
    mockSave = jest.fn();
    mockEmit = jest.fn().mockResolvedValue(undefined);
    mockCredentialDefinitionFindById = jest
      .fn()
      .mockResolvedValue(mockCredentialDefinition);
    mockResolve = jest
      .fn()
      .mockResolvedValue({ connector: { id: mockConnectorId } });
    mockTransitionStatus = jest.fn().mockResolvedValue(true);
    mockGetClaimsValidationSchema = jest.fn(
      (definition: CredentialDefinition) => ({
        schema: {
          type: 'object',
          properties: {
            ...(definition.format === CredentialDefinitionFormat.ANONCREDS
              ? {
                  given_name: { type: 'string' },
                  family_name: { type: 'string' },
                }
              : {}),
          },
        },
        mandatoryClaims: [],
      }),
    );
    mockDeleteIfUnused = jest
      .fn()
      .mockResolvedValue(IssuanceProfileDeleteResult.DELETED);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IssuanceProfileService,
        {
          provide: DataSource,
          useValue: {
            transaction: (
              work: (transactionManager: EntityManager) => Promise<unknown>,
            ) => work(manager),
          },
        },
        {
          provide: IssuanceProfileRepository,
          useValue: {
            create: mockCreate,
            findById: mockFindById,
            findForUpdate: (): unknown => mockFindById(),
            findByNameAndVersion: mockFindByNameAndVersion,
            findPage: mockFindPage,
            findUsedProfileIds: mockFindUsedProfileIds,
            save: mockSave,
            transitionStatus: mockTransitionStatus,
            deleteIfUnused: mockDeleteIfUnused,
          },
        },
        {
          provide: CredentialDefinitionService,
          useValue: {
            findById: mockCredentialDefinitionFindById,
            getClaimsValidationSchema: mockGetClaimsValidationSchema,
          },
        },
        {
          provide: AdapterRegistry,
          useValue: { resolve: mockResolve },
        },
        {
          provide: DomainAuditService,
          useValue: { emit: mockEmit },
        },
      ],
    }).compile();

    service = module.get<IssuanceProfileService>(IssuanceProfileService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const dto: CreateIssuanceProfileDto = {
      name: 'drivers-license',
      version: '1.0',
      credentialDefinitionId: mockCredentialDefinition.id,
      claims: { required: ['given_name'], properties: {} },
      delivery: { protocol: 'didcomm-v1' },
    };

    it('creates a profile in draft status', async () => {
      mockFindByNameAndVersion.mockResolvedValue(null);
      mockCreate.mockResolvedValue(mockProfile);

      const result = await service.create(tenantId, dto, auth);

      expect(mockCredentialDefinitionFindById).toHaveBeenCalledWith(
        tenantId,
        dto.credentialDefinitionId,
        auth,
      );
      expect(mockResolve).toHaveBeenCalledWith(
        tenantId,
        CredentialFormat.AnonCreds,
        { connectorId: mockConnectorId },
      );
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          name: dto.name,
          version: dto.version,
          credentialDefinitionId: mockCredentialDefinition.id,
          claims: dto.claims,
          delivery: dto.delivery,
        }),
        manager,
      );
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: mockProfile.tenantId,
        action: AuditAction.CREATE,
        resourceType: 'issuance_profile',
        resourceId: mockProfile.id,
      });
      expect(result).toBe(mockProfile);
      expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('format');
      expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('connectorId');
    });

    it('stores an empty map when constraints are omitted', async () => {
      mockCreate.mockResolvedValue(mockProfile);
      await service.create(tenantId, { ...dto, claims: undefined }, auth);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          claims: {},
        }),
        manager,
      );
    });

    it('rejects a default in profile claims before persisting a profile', async () => {
      await expect(
        service.create(
          tenantId,
          {
            ...dto,
            claims: { properties: { given_name: { default: '' } } },
          },
          auth,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('throws ConflictException when name/version already exists for tenant', async () => {
      mockFindByNameAndVersion.mockResolvedValue(mockProfile);

      await expect(service.create(tenantId, dto, auth)).rejects.toThrow(
        ConflictException,
      );
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it.each(['unverified', 'pending', 'failed'] as const)(
      'rejects a %s definition before resolving a connector',
      async (registrationState) => {
        mockCredentialDefinitionFindById.mockResolvedValue({
          ...mockCredentialDefinition,
          registrationState,
        });
        await expect(service.create(tenantId, dto, auth)).rejects.toThrow(
          BadRequestException,
        );
        expect(mockResolve).not.toHaveBeenCalled();
        expect(mockCreate).not.toHaveBeenCalled();
      },
    );

    it.each([mockConnectorId, '123e4567-e89b-12d3-a456-426614174099'])(
      'rejects connector_id in the create request (%s)',
      async (connectorId) => {
        const request = plainToInstance(CreateIssuanceProfileDto, {
          name: dto.name,
          version: dto.version,
          credential_definition_id: dto.credentialDefinitionId,
          claims: dto.claims,
          delivery: dto.delivery,
          connector_id: connectorId,
        });

        const errors = await validate(request, {
          whitelist: true,
          forbidNonWhitelisted: true,
        });

        expect(errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              property: 'connector_id',
              constraints: expect.objectContaining({
                whitelistValidation: expect.any(String),
              }),
            }),
          ]),
        );
      },
    );

    it('binds a profile to the definition connector when no selection is provided', async () => {
      const boundConnectorId = '123e4567-e89b-12d3-a456-426614174099';
      mockCredentialDefinitionFindById.mockResolvedValue({
        ...mockCredentialDefinition,
        connectorId: boundConnectorId,
      });
      mockResolve.mockResolvedValue({ connector: { id: boundConnectorId } });
      mockCreate.mockResolvedValue(mockProfile);

      await service.create(tenantId, dto, auth);

      expect(mockResolve).toHaveBeenCalledWith(
        tenantId,
        CredentialFormat.AnonCreds,
        { connectorId: boundConnectorId },
      );
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          credentialDefinitionId: mockCredentialDefinition.id,
        }),
        manager,
      );
      expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('connectorId');
    });

    it('does not fall back when the definition connector is unavailable', async () => {
      mockResolve.mockRejectedValue(
        new ConnectorUnavailableError('Bound connector is unavailable'),
      );

      await expect(service.create(tenantId, dto, auth)).rejects.toThrow(
        BadRequestException,
      );

      expect(mockResolve).toHaveBeenCalledTimes(1);
      expect(mockResolve).toHaveBeenCalledWith(
        tenantId,
        CredentialFormat.AnonCreds,
        { connectorId: mockConnectorId },
      );
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it.each([null, undefined])(
      'rejects a definition without a connector binding (%s)',
      async (connectorId) => {
        mockCredentialDefinitionFindById.mockResolvedValue({
          ...mockCredentialDefinition,
          connectorId,
          status: CredentialDefinitionStatus.DRAFT,
        });
        await expect(service.create(tenantId, dto, auth)).rejects.toThrow(
          'Credential definition has no connector binding.',
        );
        expect(mockResolve).not.toHaveBeenCalled();
        expect(mockCreate).not.toHaveBeenCalled();
        expect(mockEmit).not.toHaveBeenCalled();
      },
    );

    it('throws NotFoundException when the credential definition is cross-tenant', async () => {
      mockCredentialDefinitionFindById.mockRejectedValue(
        new NotFoundException('Credential definition was not found.'),
      );

      await expect(service.create(tenantId, dto, auth)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockFindByNameAndVersion).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for claims outside the definition', async () => {
      const badDto: CreateIssuanceProfileDto = {
        ...dto,
        claims: { required: ['unknown'] },
      };
      mockFindByNameAndVersion.mockResolvedValue(null);

      await expect(service.create(tenantId, badDto, auth)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockFindByNameAndVersion).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the connector does not support the format', async () => {
      mockFindByNameAndVersion.mockResolvedValue(null);
      mockResolve.mockRejectedValue(new FormatNotSupportedError('anoncreds'));

      await expect(service.create(tenantId, dto, auth)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rethrows non-adapter errors from connector resolution', async () => {
      mockFindByNameAndVersion.mockResolvedValue(null);
      const unexpected = new Error('boom');
      mockResolve.mockRejectedValue(unexpected);

      await expect(service.create(tenantId, dto, auth)).rejects.toThrow(
        unexpected,
      );
    });

    it('allows an empty overlay for formats without claim schema data', async () => {
      // MDL maps to a port-layer format (unlike SD-JWT/W3C VC), so this
      // also exercises the format-mapped connector-resolution path.
      const mdlDefinition: CredentialDefinition = {
        ...mockCredentialDefinition,
        format: CredentialDefinitionFormat.MDL,
        schemaDefinition: {},
      };
      mockCredentialDefinitionFindById.mockResolvedValue(mdlDefinition);
      mockFindByNameAndVersion.mockResolvedValue(null);
      mockCreate.mockResolvedValue(mockProfile);

      const emptyDto: CreateIssuanceProfileDto = {
        ...dto,
        claims: {},
      };

      await expect(service.create(tenantId, emptyDto, auth)).resolves.toBe(
        mockProfile,
      );
      expect(mockResolve).toHaveBeenCalledWith(tenantId, CredentialFormat.Mdl, {
        connectorId: mockConnectorId,
      });
    });

    it.each([
      CredentialDefinitionFormat.SD_JWT,
      CredentialDefinitionFormat.W3C_VC,
    ])(
      'throws BadRequestException for %s, which has no port-layer format mapping',
      async (format) => {
        const definitionWithUnmappedFormat: CredentialDefinition = {
          ...mockCredentialDefinition,
          format,
          schemaDefinition: {},
        };
        mockCredentialDefinitionFindById.mockResolvedValue(
          definitionWithUnmappedFormat,
        );
        mockFindByNameAndVersion.mockResolvedValue(null);

        await expect(service.create(tenantId, dto, auth)).rejects.toThrow(
          BadRequestException,
        );
        expect(mockResolve).not.toHaveBeenCalled();
        expect(mockCreate).not.toHaveBeenCalled();
      },
    );

    it('translates a losing unique-constraint race into ConflictException', async () => {
      mockFindByNameAndVersion.mockResolvedValue(null);
      const constraintViolation = new QueryFailedError(
        'INSERT INTO "issuance_profile" ...',
        [],
        new Error('duplicate key value violates unique constraint') as Error &
          Record<string, unknown>,
      );
      Object.assign(
        constraintViolation.driverError as Record<string, unknown>,
        {
          code: '23505',
          constraint: 'uq_issuance_profile_tenant_name_version',
        },
      );
      mockCreate.mockRejectedValue(constraintViolation);

      await expect(service.create(tenantId, dto, auth)).rejects.toThrow(
        ConflictException,
      );
    });

    it('rethrows a QueryFailedError from an unrelated constraint', async () => {
      mockFindByNameAndVersion.mockResolvedValue(null);
      const otherViolation = new QueryFailedError(
        'INSERT INTO "issuance_profile" ...',
        [],
        new Error('some other db error') as Error & Record<string, unknown>,
      );
      Object.assign(otherViolation.driverError as Record<string, unknown>, {
        code: '23503',
      });
      mockCreate.mockRejectedValue(otherViolation);

      await expect(service.create(tenantId, dto, auth)).rejects.toThrow(
        otherViolation,
      );
    });
  });

  describe('findById', () => {
    it('returns the profile when it belongs to the tenant', async () => {
      mockFindById.mockResolvedValue(mockProfile);

      const result = await service.findById(tenantId, mockProfile.id, auth);

      expect(result).toEqual(mockProfile);
    });

    it('throws NotFoundException for a cross-tenant profile', async () => {
      mockFindById.mockResolvedValue({ ...mockProfile, tenantId: 'other' });

      await expect(
        service.findById(tenantId, mockProfile.id, auth),
      ).rejects.toThrow('was not found');
    });

    it('throws NotFoundException when the profile does not exist', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(
        service.findById(tenantId, mockProfile.id, auth),
      ).rejects.toThrow('was not found');
    });
  });

  describe('findByTenantId', () => {
    it('marks profiles referenced by any request as non-deletable', async () => {
      mockFindPage.mockResolvedValue({
        items: [mockProfile],
        nextCursor: null,
        hasMore: false,
      });
      mockFindUsedProfileIds.mockResolvedValue(new Set([mockProfile.id]));
      const result = await service.findByTenantId(tenantId, {});
      expect(mockFindUsedProfileIds).toHaveBeenCalledWith(tenantId, [
        mockProfile.id,
      ]);
      expect(result.data[0]?.canDelete).toBe(false);
    });

    it('delegates to the repository with the provided filters and default paging', async () => {
      mockFindPage.mockResolvedValue({
        items: [mockProfile],
        nextCursor: null,
        hasMore: false,
      });

      const result = await service.findByTenantId(tenantId, {
        status: IssuanceProfileStatus.DRAFT,
      });

      expect(mockFindPage).toHaveBeenCalledWith(
        tenantId,
        { status: IssuanceProfileStatus.DRAFT },
        { limit: 20, cursor: null },
      );
      expect(result).toEqual({
        data: [{ ...mockProfile, canDelete: true }],
        pagination: { next_cursor: null, has_more: false },
      });
    });

    it('returns an empty page with no next cursor when there are no results', async () => {
      mockFindPage.mockResolvedValue({
        items: [],
        nextCursor: null,
        hasMore: false,
      });

      const result = await service.findByTenantId(tenantId, {}, {});

      expect(result).toEqual({
        data: [],
        pagination: { next_cursor: null, has_more: false },
      });
    });

    it('encodes the next cursor when more results are available', async () => {
      mockFindPage.mockResolvedValue({
        items: [mockProfile],
        nextCursor: {
          createdAt: mockProfile.createdAt.toISOString(),
          id: mockProfile.id,
        },
        hasMore: true,
      });

      const result = await service.findByTenantId(tenantId, {}, { limit: 1 });

      expect(mockFindPage).toHaveBeenCalledWith(
        tenantId,
        {},
        { limit: 1, cursor: null },
      );
      expect(result.pagination.has_more).toBe(true);
      expect(result.pagination.next_cursor).toEqual(
        encodeCursor({
          createdAt: mockProfile.createdAt.toISOString(),
          id: mockProfile.id,
        }),
      );
    });

    it('decodes a cursor supplied by the caller and passes it to the repository', async () => {
      const cursor = encodeCursor({
        createdAt: '2024-01-01T00:00:00.000Z',
        id: mockProfile.id,
      });
      mockFindPage.mockResolvedValue({
        items: [],
        nextCursor: null,
        hasMore: false,
      });

      await service.findByTenantId(tenantId, {}, { cursor });

      expect(mockFindPage).toHaveBeenCalledWith(
        tenantId,
        {},
        {
          limit: 20,
          cursor: { createdAt: '2024-01-01T00:00:00.000Z', id: mockProfile.id },
        },
      );
    });

    it('rejects a malformed cursor with BadRequestException', async () => {
      await expect(
        service.findByTenantId(tenantId, {}, { cursor: 'not-base64url-json' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockFindPage).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('rejects a profile removed before the draft lock is acquired', async () => {
      mockFindById
        .mockResolvedValueOnce({ ...mockProfile })
        .mockResolvedValueOnce(null);
      await expect(
        service.update(
          tenantId,
          mockProfile.id,
          { description: 'Updated' },
          auth,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockSave).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('stores display and metadata edits', async () => {
      mockFindById.mockResolvedValue({ ...mockProfile });
      mockSave.mockImplementation((profile) => Promise.resolve(profile));
      const dto = {
        display: { name: 'Driver licence' },
        metadata: { category: 'licence' },
      };
      const result = await service.update(tenantId, mockProfile.id, dto, auth);
      expect(result).toMatchObject(dto);
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining(dto),
        manager,
      );
    });
    it('updates delivery and claims on a draft profile', async () => {
      mockFindById.mockResolvedValue({ ...mockProfile });
      mockSave.mockImplementation((profile) => Promise.resolve(profile));
      const claims = {
        properties: { given_name: { enum: ['Alice'] } },
      };
      const result = await service.update(
        tenantId,
        mockProfile.id,
        {
          claims,
          delivery: { protocol: 'didcomm-v1' },
        },
        auth,
      );
      expect(result.claims).toEqual(claims);
      expect(result.delivery).toEqual({ protocol: 'didcomm-v1' });
    });

    it('rejects invalid claims edits before saving', async () => {
      mockFindById.mockResolvedValue({ ...mockProfile });
      await expect(
        service.update(
          tenantId,
          mockProfile.id,
          {
            claims: { properties: { given_name: { default: '' } } },
          },
          auth,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockSave).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('updates a draft profile', async () => {
      mockFindById
        .mockResolvedValueOnce({ ...mockProfile })
        .mockResolvedValueOnce({ ...mockProfile, description: 'Updated' });

      const dto: UpdateIssuanceProfileDto = { description: 'Updated' };
      mockSave.mockImplementation((profile) => Promise.resolve(profile));
      const result = await service.update(tenantId, mockProfile.id, dto, auth);

      expect(result.description).toBe('Updated');
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: mockProfile.tenantId,
        action: AuditAction.UPDATE,
        resourceType: 'issuance_profile',
        resourceId: mockProfile.id,
      });
    });

    it('throws ConflictException when the profile is not in draft status', async () => {
      mockFindById.mockResolvedValue({
        ...mockProfile,
        status: IssuanceProfileStatus.PUBLISHED,
      });

      await expect(
        service.update(tenantId, mockProfile.id, { description: 'nope' }, auth),
      ).rejects.toThrow(ConflictException);
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('rejects when publication wins after the initial draft read', async () => {
      mockFindById
        .mockResolvedValueOnce({ ...mockProfile })
        .mockResolvedValueOnce({
          ...mockProfile,
          status: IssuanceProfileStatus.PUBLISHED,
        });

      await expect(
        service.update(
          tenantId,
          mockProfile.id,
          { description: 'Updated' },
          auth,
        ),
      ).rejects.toThrow(ConflictException);
      expect(mockSave).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  describe('publish', () => {
    it.each([null, { tenantId: 'other-tenant' }])(
      'does not record publication when the transaction reload returns %p',
      async (reloaded) => {
        mockFindById
          .mockResolvedValueOnce({ ...mockProfile })
          .mockResolvedValueOnce(reloaded);
        await expect(
          service.publish(tenantId, mockProfile.id, auth),
        ).rejects.toThrow(NotFoundException);
        expect(mockEmit).not.toHaveBeenCalled();
      },
    );
    it.each([
      CredentialDefinitionStatus.DRAFT,
      CredentialDefinitionStatus.DEPRECATED,
    ])('rejects publication when the definition is %s', async (status) => {
      mockFindById.mockResolvedValue({ ...mockProfile });
      mockCredentialDefinitionFindById.mockResolvedValue({
        ...mockCredentialDefinition,
        status,
        isActive: true,
      });

      await expect(
        service.publish(tenantId, mockProfile.id, auth),
      ).rejects.toThrow(
        'Credential definition must be published before publishing an issuance profile.',
      );
      expect(mockResolve).not.toHaveBeenCalled();
      expect(mockTransitionStatus).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('publishes a draft profile with a healthy connector', async () => {
      mockFindById
        .mockResolvedValueOnce({ ...mockProfile })
        .mockResolvedValueOnce({
          ...mockProfile,
          status: IssuanceProfileStatus.PUBLISHED,
        });

      const result = await service.publish(tenantId, mockProfile.id, auth);

      expect(mockResolve).toHaveBeenCalledWith(
        tenantId,
        CredentialFormat.AnonCreds,
        { connectorId: mockConnectorId },
      );
      expect(mockTransitionStatus).toHaveBeenCalledWith(
        tenantId,
        mockProfile.id,
        IssuanceProfileStatus.DRAFT,
        IssuanceProfileStatus.PUBLISHED,
        {
          id: mockCredentialDefinition.id,
          connectorId: mockConnectorId,
          format: mockCredentialDefinition.format,
        },
        manager,
      );
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: mockProfile.tenantId,
        action: AuditAction.UPDATE,
        resourceType: 'issuance_profile',
        resourceId: mockProfile.id,
      });
      expect(result).toMatchObject({
        ...mockProfile,
        status: IssuanceProfileStatus.PUBLISHED,
      });
    });

    it('requires a ready definition on the selected connector before publishing', async () => {
      mockFindById.mockResolvedValue({ ...mockProfile });
      mockCredentialDefinitionFindById.mockResolvedValue({
        ...mockCredentialDefinition,
        registrationState: 'pending',
      });

      await expect(
        service.publish(tenantId, mockProfile.id, auth),
      ).rejects.toThrow(BadRequestException);

      expect(mockTransitionStatus).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the profile is not in draft status', async () => {
      mockFindById.mockResolvedValue({
        ...mockProfile,
        status: IssuanceProfileStatus.PUBLISHED,
      });

      await expect(
        service.publish(tenantId, mockProfile.id, auth),
      ).rejects.toThrow(ConflictException);
      expect(mockTransitionStatus).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the connector was removed', async () => {
      mockFindById.mockResolvedValue({ ...mockProfile });
      mockCredentialDefinitionFindById.mockResolvedValue({
        ...mockCredentialDefinition,
        connectorId: null,
      });

      await expect(
        service.publish(tenantId, mockProfile.id, auth),
      ).rejects.toThrow(BadRequestException);
      expect(mockResolve).not.toHaveBeenCalled();
      expect(mockTransitionStatus).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the connector no longer resolves', async () => {
      mockFindById.mockResolvedValue({ ...mockProfile });
      mockResolve.mockRejectedValue(new FormatNotSupportedError('anoncreds'));

      await expect(
        service.publish(tenantId, mockProfile.id, auth),
      ).rejects.toThrow(BadRequestException);
      expect(mockTransitionStatus).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the transition loses a race', async () => {
      mockFindById.mockResolvedValue({ ...mockProfile });
      mockTransitionStatus.mockResolvedValue(false);

      await expect(
        service.publish(tenantId, mockProfile.id, auth),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when the connector changes between the health check and the transition', async () => {
      mockFindById.mockResolvedValue({ ...mockProfile });
      mockTransitionStatus.mockResolvedValue(false);

      await expect(
        service.publish(tenantId, mockProfile.id, auth),
      ).rejects.toThrow(ConflictException);
      expect(mockTransitionStatus).toHaveBeenCalledWith(
        tenantId,
        mockProfile.id,
        IssuanceProfileStatus.DRAFT,
        IssuanceProfileStatus.PUBLISHED,
        {
          id: mockCredentialDefinition.id,
          connectorId: mockConnectorId,
          format: mockCredentialDefinition.format,
        },
        manager,
      );
    });
  });

  describe('deprecate', () => {
    it.each([null, { tenantId: 'other-tenant' }])(
      'does not record deprecation when the transaction reload returns %p',
      async (reloaded) => {
        mockFindById
          .mockResolvedValueOnce({
            ...mockProfile,
            status: IssuanceProfileStatus.PUBLISHED,
          })
          .mockResolvedValueOnce(reloaded);
        await expect(
          service.deprecate(tenantId, mockProfile.id, auth),
        ).rejects.toThrow(NotFoundException);
        expect(mockEmit).not.toHaveBeenCalled();
      },
    );
    const publishedProfile = {
      ...mockProfile,
      status: IssuanceProfileStatus.PUBLISHED,
    };

    it('deprecates a published profile', async () => {
      mockFindById
        .mockResolvedValueOnce({ ...publishedProfile })
        .mockResolvedValueOnce({
          ...publishedProfile,
          status: IssuanceProfileStatus.DEPRECATED,
        });

      const result = await service.deprecate(tenantId, mockProfile.id, auth);

      expect(mockTransitionStatus).toHaveBeenCalledWith(
        tenantId,
        mockProfile.id,
        IssuanceProfileStatus.PUBLISHED,
        IssuanceProfileStatus.DEPRECATED,
        undefined,
        manager,
      );
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: publishedProfile.tenantId,
        action: AuditAction.UPDATE,
        resourceType: 'issuance_profile',
        resourceId: publishedProfile.id,
      });
      expect(result).toMatchObject({
        ...publishedProfile,
        status: IssuanceProfileStatus.DEPRECATED,
      });
    });

    it('throws ConflictException when the profile is not in published status', async () => {
      mockFindById.mockResolvedValue({ ...mockProfile });

      await expect(
        service.deprecate(tenantId, mockProfile.id, auth),
      ).rejects.toThrow(ConflictException);
      expect(mockTransitionStatus).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the transition loses a race', async () => {
      mockFindById.mockResolvedValue({ ...publishedProfile });
      mockTransitionStatus.mockResolvedValue(false);

      await expect(
        service.deprecate(tenantId, mockProfile.id, auth),
      ).rejects.toThrow(ConflictException);
    });
  });
});

// Sanity check that AdapterError subclasses are recognized by instanceof
// checks in the service (guards against a future refactor of the error
// hierarchy silently breaking the catch in resolveConnector).
describe('AdapterError instanceof', () => {
  it('FormatNotSupportedError is an AdapterError', () => {
    expect(new FormatNotSupportedError('anoncreds')).toBeInstanceOf(
      AdapterError,
    );
  });
});
