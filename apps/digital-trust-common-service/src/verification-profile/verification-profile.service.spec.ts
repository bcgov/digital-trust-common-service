import { AuthContext } from '@app/auth';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';

import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { CredentialDefinitionFormat } from '../credential-definition/credential-definition.entity';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { OperationStepState } from '../operation/operation.entity';
import { OperationService } from '../operation/operation.service';

import { CreateVerificationProfileDto } from './dto/create-verification-profile.dto';
import { UpdateVerificationProfileDto } from './dto/update-verification-profile.dto';
import { PresentationDefinitionRepository } from './presentation-definition.repository';
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
  let mockUpdateIfDraft: jest.Mock;
  let mockTransitionStatus: jest.Mock;
  let mockEmit: jest.Mock;
  const manager = {} as EntityManager;
  const createCompleted = jest.fn();
  const definitionCreate = jest.fn();
  const definitionFindById = jest.fn();
  const definitionUpdateIfDraft = jest.fn();
  const definitionTransitionStatus = jest.fn();
  const definitionFindPage = jest.fn();
  const hasPublishedDefinition = jest.fn();

  const tenantId = '123e4567-e89b-12d3-a456-426614174001';

  const mockProfile: VerificationProfile = {
    id: '123e4567-e89b-12d3-a456-426614174003',
    presentationDefinitionId: '123e4567-e89b-12d3-a456-426614174003',
    tenantId,
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
    mockUpdateIfDraft = jest.fn().mockResolvedValue(true);
    mockTransitionStatus = jest.fn().mockResolvedValue(true);
    mockEmit = jest.fn().mockResolvedValue(undefined);
    createCompleted
      .mockReset()
      .mockImplementation((_input, result) =>
        Promise.resolve({ id: 'configuration-op', result }),
      );
    definitionCreate.mockReset();
    definitionFindById.mockReset().mockResolvedValue({
      ...mockProfile,
      status: VerificationProfileStatus.PUBLISHED,
    });
    definitionUpdateIfDraft.mockReset().mockResolvedValue(true);
    definitionTransitionStatus.mockReset().mockResolvedValue(true);
    definitionFindPage.mockReset();
    hasPublishedDefinition.mockReset().mockResolvedValue(false);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationProfileService,
        {
          provide: DataSource,
          useValue: {
            transaction: (
              callback: (manager: EntityManager) => Promise<unknown>,
            ) => callback(manager),
          },
        },
        {
          provide: OperationService,
          useValue: { createCompleted },
        },
        {
          provide: PresentationDefinitionRepository,
          useValue: {
            create: definitionCreate,
            findById: definitionFindById,
            updateIfDraft: definitionUpdateIfDraft,
            transitionStatus: definitionTransitionStatus,
            findPage: definitionFindPage,
          },
        },
        {
          provide: VerificationProfileRepository,
          useValue: {
            create: mockCreate,
            findById: mockFindById,
            findByNameAndVersion: mockFindByNameAndVersion,
            findPage: mockFindPage,
            save: mockSave,
            updateIfDraft: mockUpdateIfDraft,
            transitionStatus: mockTransitionStatus,
            hasPublishedDefinition,
          },
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

  it('records profile mutations and their response snapshot in one transaction', async () => {
    const definition = {
      ...mockProfile,
      status: VerificationProfileStatus.PUBLISHED,
    };
    const profile = { ...mockProfile, definition };
    const result = await service.profileOperation(
      tenantId,
      OPERATION_TYPE.VERIFICATION_PROFILE_UPDATE,
      'PATCH',
      `/${profile.id}`,
      { description: 'updated' },
      (receivedManager) => {
        expect(receivedManager).toBe(manager);
        return Promise.resolve(profile);
      },
    );
    expect(createCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        type: OPERATION_TYPE.VERIFICATION_PROFILE_UPDATE,
      }),
      expect.objectContaining({
        presentation_definition_id: profile.presentationDefinitionId,
      }),
      manager,
    );
    expect(result.id).toBe('configuration-op');
  });

  describe('presentation definitions', () => {
    const dto = {
      name: 'identity',
      version: '1.0',
      query: {
        type: 'dif-presentation-exchange' as const,
        presentationDefinition: mockProfile.presentationDefinition,
      },
      options: { format: CredentialDefinitionFormat.ANONCREDS as const },
    };

    it('stores the definition separately with the selected output format', async () => {
      definitionCreate.mockResolvedValue(mockProfile);
      await service.createDefinition(tenantId, dto, auth);
      expect(definitionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          presentationFormat: CredentialDefinitionFormat.ANONCREDS,
        }),
        manager,
      );
    });

    it('persists the mutation and completed immutable snapshot with one transaction manager', async () => {
      definitionCreate.mockResolvedValue(mockProfile);
      const result = await service.createDefinition(tenantId, dto, auth);
      expect(createCompleted).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          type: OPERATION_TYPE.PRESENTATION_DEFINITION_CREATE,
          steps: [
            {
              type: OPERATION_TYPE.PRESENTATION_DEFINITION_CREATE,
              state: OperationStepState.COMPLETED,
            },
          ],
        }),
        expect.objectContaining({
          id: mockProfile.id,
          tenant_id: tenantId,
          query: expect.objectContaining({
            presentation_definition: mockProfile.presentationDefinition,
          }),
        }),
        manager,
      );
      expect(result.id).toBe('configuration-op');
      expect(result.result?.id).toBe(mockProfile.id);
    });

    it('does not report success or emit audit if operation persistence fails', async () => {
      definitionCreate.mockResolvedValue(mockProfile);
      createCompleted.mockRejectedValue(new Error('database unavailable'));
      await expect(
        service.createDefinition(tenantId, dto, auth),
      ).rejects.toThrow('database unavailable');
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it.each([
      [
        'publishDefinition',
        VerificationProfileStatus.DRAFT,
        OPERATION_TYPE.PRESENTATION_DEFINITION_PUBLISH,
      ],
      [
        'deprecateDefinition',
        VerificationProfileStatus.PUBLISHED,
        OPERATION_TYPE.PRESENTATION_DEFINITION_DEPRECATE,
      ],
    ] as const)(
      'creates a typed Operation for %s',
      async (method, status, type) => {
        definitionFindById.mockResolvedValue({ ...mockProfile, status });
        await service[method](tenantId, mockProfile.id, auth);
        expect(definitionTransitionStatus).toHaveBeenCalledWith(
          tenantId,
          mockProfile.id,
          status,
          expect.any(String),
          manager,
        );
        expect(createCompleted).toHaveBeenCalledWith(
          expect.objectContaining({
            type,
            steps: [{ type, state: OperationStepState.COMPLETED }],
          }),
          expect.anything(),
          manager,
        );
      },
    );

    it('updates draft query/options and clears removed predicates atomically', async () => {
      definitionFindById.mockResolvedValue(mockProfile);
      await service.updateDefinition(tenantId, mockProfile.id, dto, auth);
      expect(definitionUpdateIfDraft).toHaveBeenCalledWith(
        tenantId,
        mockProfile.id,
        expect.objectContaining({
          presentationDefinition: mockProfile.presentationDefinition,
          presentationFormat: CredentialDefinitionFormat.ANONCREDS,
          predicates: [],
        }),
        manager,
      );
    });

    it('retains published immutability through the new resource', async () => {
      definitionFindById.mockResolvedValue({
        ...mockProfile,
        status: VerificationProfileStatus.PUBLISHED,
      });

      await expect(
        service.updateDefinition(tenantId, mockProfile.id, dto, auth),
      ).rejects.toThrow(ConflictException);
      expect(definitionUpdateIfDraft).not.toHaveBeenCalled();
    });

    it('does not deprecate a definition referenced by a published profile', async () => {
      hasPublishedDefinition.mockResolvedValue(true);
      await expect(
        service.deprecateDefinition(tenantId, mockProfile.id, auth),
      ).rejects.toThrow(ConflictException);
      expect(definitionTransitionStatus).not.toHaveBeenCalled();
      expect(createCompleted).not.toHaveBeenCalled();
    });

    it('rejects another tenant before creating/listing definitions', async () => {
      await expect(
        service.createDefinition('other-tenant', dto, auth),
      ).rejects.toThrow();
      await expect(
        service.findDefinitions('other-tenant', {}, auth),
      ).rejects.toThrow();
      expect(definitionCreate).not.toHaveBeenCalled();
      expect(definitionFindPage).not.toHaveBeenCalled();
    });

    it('scopes definition list pagination to the authenticated tenant', async () => {
      definitionFindPage.mockResolvedValue({
        items: [mockProfile],
        hasMore: false,
        nextCursor: null,
      });
      const page = await service.findDefinitions(tenantId, {}, auth);
      expect(page.data).toEqual([mockProfile]);
      expect(definitionFindPage).toHaveBeenCalledWith(
        tenantId,
        undefined,
        expect.anything(),
      );
    });
  });

  describe('create', () => {
    const dto: CreateVerificationProfileDto = {
      name: 'age-verification',
      version: '1.0',
      presentationDefinitionId: mockProfile.id,
    };

    beforeEach(() => {
      definitionFindById.mockResolvedValue(mockProfile);
    });

    it('creates a profile linked to the tenant definition', async () => {
      mockFindByNameAndVersion.mockResolvedValue(null);
      mockCreate.mockResolvedValue(mockProfile);

      const result = await service.create(tenantId, dto, auth);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          name: dto.name,
          version: dto.version,
          presentationDefinitionId: mockProfile.id,
          isPublic: false,
        }),
        undefined,
      );
      expect(mockEmit).toHaveBeenCalledWith({
        tenantId: mockProfile.tenantId,
        action: AuditAction.CREATE,
        resourceType: 'verification_profile',
        resourceId: mockProfile.id,
      });
      expect(result).toBe(mockProfile);
    });

    it('rejects a definition outside the tenant', async () => {
      definitionFindById.mockResolvedValue(null);
      await expect(service.create(tenantId, dto, auth)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockCreate).not.toHaveBeenCalled();
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

    it('rethrows a repository error unrelated to the unique constraint', async () => {
      mockFindByNameAndVersion.mockResolvedValue(null);
      mockCreate.mockRejectedValue(new Error('connection lost'));

      await expect(service.create(tenantId, dto, auth)).rejects.toThrow(
        'connection lost',
      );
    });

    it('rethrows a QueryFailedError for an unrelated constraint violation', async () => {
      mockFindByNameAndVersion.mockResolvedValue(null);
      mockCreate.mockRejectedValue(
        Object.assign(
          new QueryFailedError('insert', [], new Error('fk violation')),
          { driverError: { code: '23503', constraint: 'fk_other' } },
        ),
      );

      await expect(service.create(tenantId, dto, auth)).rejects.toThrow(
        QueryFailedError,
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

    it('rejects an invalid pagination cursor', async () => {
      const invalidCursor = Buffer.from('not json', 'utf8').toString(
        'base64url',
      );

      await expect(
        service.findByTenantId(tenantId, {}, { cursor: invalidCursor }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a well-formed JSON cursor missing required fields', async () => {
      const malformedCursor = Buffer.from(
        JSON.stringify({ foo: 'bar' }),
        'utf8',
      ).toString('base64url');

      await expect(
        service.findByTenantId(tenantId, {}, { cursor: malformedCursor }),
      ).rejects.toThrow(BadRequestException);
    });

    it('decodes a valid cursor and passes it to the repository', async () => {
      mockFindPage.mockResolvedValue({
        items: [mockProfile],
        nextCursor: null,
        hasMore: false,
      });
      const decoded = {
        createdAt: '2024-01-01T00:00:00.000Z',
        id: '123e4567-e89b-42d3-a456-426614174001',
      };
      const validCursor = Buffer.from(JSON.stringify(decoded), 'utf8').toString(
        'base64url',
      );

      await service.findByTenantId(tenantId, {}, { cursor: validCursor });

      expect(mockFindPage).toHaveBeenCalledWith(
        tenantId,
        {},
        { limit: 20, cursor: decoded },
      );
    });
  });

  describe('update', () => {
    it('updates metadata without requiring or changing the definition', async () => {
      mockFindById.mockResolvedValue({ ...mockProfile });
      await service.update(
        tenantId,
        mockProfile.id,
        { metadata: { label: 'new' } },
        auth,
      );
      expect(definitionFindById).not.toHaveBeenCalled();
      expect(mockUpdateIfDraft).toHaveBeenCalledWith(
        tenantId,
        mockProfile.id,
        { metadata: { label: 'new' } },
        undefined,
      );
    });
    it('updates description on a draft profile', async () => {
      mockFindById
        .mockResolvedValueOnce({ ...mockProfile })
        .mockResolvedValueOnce({ ...mockProfile, description: 'Updated' });

      const dto: UpdateVerificationProfileDto = {
        presentationDefinitionId: mockProfile.id,
        description: 'Updated',
      };
      const result = await service.update(tenantId, mockProfile.id, dto, auth);

      expect(mockUpdateIfDraft).toHaveBeenCalledWith(
        tenantId,
        mockProfile.id,
        expect.objectContaining({
          presentationDefinitionId: mockProfile.id,
          description: 'Updated',
        }),
        undefined,
      );
      expect(result.description).toBe('Updated');
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.UPDATE }),
      );
    });

    it('updates the linked definition for a draft profile', async () => {
      mockFindById
        .mockResolvedValueOnce({ ...mockProfile })
        .mockResolvedValueOnce({
          ...mockProfile,
          requestedAttributes: ['given_names'],
        });

      const dto: UpdateVerificationProfileDto = {
        presentationDefinitionId: mockProfile.id,
      };

      const result = await service.update(tenantId, mockProfile.id, dto, auth);

      expect(result.requestedAttributes).toEqual(['given_names']);
      expect(mockUpdateIfDraft).toHaveBeenCalledWith(
        tenantId,
        mockProfile.id,
        expect.objectContaining({ presentationDefinitionId: mockProfile.id }),
        undefined,
      );
    });

    it('rejects updating a published profile', async () => {
      mockFindById.mockResolvedValue({
        ...mockProfile,
        status: VerificationProfileStatus.PUBLISHED,
      });

      await expect(
        service.update(
          tenantId,
          mockProfile.id,
          { presentationDefinitionId: mockProfile.id, description: 'x' },
          auth,
        ),
      ).rejects.toThrow(ConflictException);
      expect(mockUpdateIfDraft).not.toHaveBeenCalled();
    });

    it('rejects when the guarded update loses the race to a concurrent publish', async () => {
      mockFindById.mockResolvedValue({ ...mockProfile });
      mockUpdateIfDraft.mockResolvedValue(false);

      await expect(
        service.update(
          tenantId,
          mockProfile.id,
          { presentationDefinitionId: mockProfile.id, description: 'x' },
          auth,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('copies predicates from the linked definition', async () => {
      const predicates = [
        {
          attribute: 'birthdate_dateint',
          condition: '>=',
          value: '19',
        },
      ];
      definitionFindById.mockResolvedValue({ ...mockProfile, predicates });
      mockFindById
        .mockResolvedValueOnce({ ...mockProfile })
        .mockResolvedValueOnce({ ...mockProfile, predicates });

      const dto: UpdateVerificationProfileDto = {
        presentationDefinitionId: mockProfile.id,
      };
      const result = await service.update(tenantId, mockProfile.id, dto, auth);

      expect(result.predicates).toEqual(predicates);
    });

    it('updates metadata, public, and protocol_hint fields', async () => {
      mockFindById
        .mockResolvedValueOnce({ ...mockProfile })
        .mockResolvedValueOnce({
          ...mockProfile,
          metadata: { note: 'reviewed' },
          isPublic: true,
          protocolHint: VerificationProfileProtocolHint.OID4VP,
        });

      const dto: UpdateVerificationProfileDto = {
        presentationDefinitionId: mockProfile.id,
        metadata: { note: 'reviewed' },
        isPublic: true,
        protocolHint: VerificationProfileProtocolHint.OID4VP,
      };

      const result = await service.update(tenantId, mockProfile.id, dto, auth);

      expect(mockUpdateIfDraft).toHaveBeenCalledWith(
        tenantId,
        mockProfile.id,
        expect.objectContaining({
          presentationDefinitionId: mockProfile.id,
          metadata: { note: 'reviewed' },
          isPublic: true,
          protocolHint: VerificationProfileProtocolHint.OID4VP,
        }),
        undefined,
      );
      expect(result.metadata).toEqual({ note: 'reviewed' });
      expect(result.isPublic).toBe(true);
      expect(result.protocolHint).toBe(VerificationProfileProtocolHint.OID4VP);
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
        undefined,
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
        undefined,
      );
      expect(result.status).toBe(VerificationProfileStatus.DEPRECATED);
    });

    it('rejects deprecating a non-published profile', async () => {
      mockFindById.mockResolvedValue({ ...mockProfile });

      await expect(
        service.deprecate(tenantId, mockProfile.id, auth),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects when the transition loses the race', async () => {
      mockFindById.mockResolvedValue({
        ...mockProfile,
        status: VerificationProfileStatus.PUBLISHED,
      });
      mockTransitionStatus.mockResolvedValue(false);

      await expect(
        service.deprecate(tenantId, mockProfile.id, auth),
      ).rejects.toThrow(ConflictException);
    });
  });
});
