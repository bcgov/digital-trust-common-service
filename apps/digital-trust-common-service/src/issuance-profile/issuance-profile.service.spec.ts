import {
  AdapterError,
  CredentialFormat,
  FormatNotSupportedError,
} from '@app/credential-ports';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { QueryFailedError } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import {
  CredentialDefinition,
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
} from '../credential-definition/credential-definition.entity';
import { CredentialDefinitionService } from '../credential-definition/credential-definition.service';
import { TenantStatus } from '../tenant/tenant.entity';

import { CreateIssuanceProfileDto } from './dto/create-issuance-profile.dto';
import { UpdateIssuanceProfileDto } from './dto/update-issuance-profile.dto';
import {
  IssuanceProfile,
  IssuanceProfileProtocolHint,
  IssuanceProfileStatus,
} from './issuance-profile.entity';
import { IssuanceProfileRepository } from './issuance-profile.repository';
import { IssuanceProfileService } from './issuance-profile.service';

describe('IssuanceProfileService', () => {
  let service: IssuanceProfileService;
  let mockCreate: jest.Mock;
  let mockFindById: jest.Mock;
  let mockFindByNameAndVersion: jest.Mock;
  let mockFindByTenantWithFilters: jest.Mock;
  let mockSave: jest.Mock;
  let mockEmit: jest.Mock;
  let mockCredentialDefinitionFindById: jest.Mock;
  let mockResolve: jest.Mock;

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
    connectorType: CredentialDefinitionConnectorType.TRACTION,
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
    format: CredentialDefinitionFormat.ANONCREDS,
    connectorId: mockConnectorId,
    attributeSchema: { given_name: { type: 'string', required: true } },
    defaults: undefined,
    display: undefined,
    metadata: {},
    protocolHint: IssuanceProfileProtocolHint.AUTO,
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

  beforeEach(async () => {
    mockCreate = jest.fn();
    mockFindById = jest.fn();
    mockFindByNameAndVersion = jest.fn();
    mockFindByTenantWithFilters = jest.fn();
    mockSave = jest.fn();
    mockEmit = jest.fn().mockResolvedValue(undefined);
    mockCredentialDefinitionFindById = jest
      .fn()
      .mockResolvedValue(mockCredentialDefinition);
    mockResolve = jest
      .fn()
      .mockResolvedValue({ connector: { id: mockConnectorId } });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IssuanceProfileService,
        {
          provide: IssuanceProfileRepository,
          useValue: {
            create: mockCreate,
            findById: mockFindById,
            findByNameAndVersion: mockFindByNameAndVersion,
            findByTenantWithFilters: mockFindByTenantWithFilters,
            save: mockSave,
          },
        },
        {
          provide: CredentialDefinitionService,
          useValue: { findById: mockCredentialDefinitionFindById },
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
      attributeSchema: { given_name: { type: 'string', required: true } },
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
        { connectorId: undefined },
      );
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          name: dto.name,
          version: dto.version,
          credentialDefinitionId: mockCredentialDefinition.id,
          format: CredentialDefinitionFormat.ANONCREDS,
          connectorId: mockConnectorId,
          attributeSchema: dto.attributeSchema,
        }),
      );
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: mockProfile.tenantId,
        action: AuditAction.CREATE,
        resourceType: 'issuance_profile',
        resourceId: mockProfile.id,
      });
      expect(result).toEqual(mockProfile);
    });

    it('throws ConflictException when name/version already exists for tenant', async () => {
      mockFindByNameAndVersion.mockResolvedValue(mockProfile);

      await expect(service.create(tenantId, dto, auth)).rejects.toThrow(
        ConflictException,
      );
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the credential definition is cross-tenant', async () => {
      mockCredentialDefinitionFindById.mockRejectedValue(
        new NotFoundException('Credential definition was not found.'),
      );

      await expect(service.create(tenantId, dto, auth)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockFindByNameAndVersion).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when attribute_schema is not a subset of attr_names', async () => {
      const badDto: CreateIssuanceProfileDto = {
        ...dto,
        attributeSchema: { unknown_attribute: { type: 'string' } },
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

    it('skips the attribute subset check for formats without checkable schema data', async () => {
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

      const badDto: CreateIssuanceProfileDto = {
        ...dto,
        attributeSchema: { anything: { type: 'string' } },
      };

      await expect(service.create(tenantId, badDto, auth)).resolves.toEqual(
        mockProfile,
      );
      expect(mockResolve).toHaveBeenCalledWith(tenantId, CredentialFormat.Mdl, {
        connectorId: undefined,
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
    it('delegates to the repository with the provided filters', async () => {
      mockFindByTenantWithFilters.mockResolvedValue([mockProfile]);

      const result = await service.findByTenantId(tenantId, {
        status: IssuanceProfileStatus.DRAFT,
      });

      expect(mockFindByTenantWithFilters).toHaveBeenCalledWith(tenantId, {
        status: IssuanceProfileStatus.DRAFT,
      });
      expect(result).toEqual([mockProfile]);
    });
  });

  describe('update', () => {
    it('updates a draft profile', async () => {
      mockFindById.mockResolvedValue({ ...mockProfile });
      mockSave.mockImplementation((profile) => Promise.resolve(profile));

      const dto: UpdateIssuanceProfileDto = { description: 'Updated' };
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
