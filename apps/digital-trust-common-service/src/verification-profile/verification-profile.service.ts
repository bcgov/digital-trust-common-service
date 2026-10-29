import type { AuthContext } from '@app/auth';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import {
  assertResourceTenantOrNotFound,
  assertTenantAccess,
} from '../common/assert-tenant-access';
import { decodeCursor, encodeCursor } from '../common/cursor-pagination';
import { isUniqueConstraintViolation } from '../common/postgres-error';
import { CredentialDefinitionFormat } from '../credential-definition/credential-definition.entity';

import { CreateVerificationProfileDto } from './dto/create-verification-profile.dto';
import { ListVerificationProfilesQueryDto } from './dto/list-verification-profiles-query.dto';
import {
  CreatePresentationDefinitionDto,
  UpdatePresentationDefinitionDto,
} from './dto/presentation-definition.dto';
import { UpdateVerificationProfileDto } from './dto/update-verification-profile.dto';
import { extractRequestedAttributes } from './presentation-definition.validator';
import { assertSupportedPresentationQuery } from './presentation-query.validator';
import {
  VerificationProfile,
  VerificationProfileStatus,
} from './verification-profile.entity';
import {
  VerificationProfileFilters,
  VerificationProfileRepository,
} from './verification-profile.repository';

export type PaginatedVerificationProfiles = {
  data: VerificationProfile[];
  pagination: {
    next_cursor: string | null;
    has_more: boolean;
  };
};

@Injectable()
export class VerificationProfileService {
  public constructor(
    private readonly verificationProfileRepository: VerificationProfileRepository,
    private readonly domainAudit: DomainAuditService,
  ) {}

  public async findDefinitions(
    tenantId: string,
    query: ListVerificationProfilesQueryDto,
    auth: AuthContext,
  ): Promise<PaginatedVerificationProfiles> {
    assertTenantAccess(auth, tenantId);
    return this.findByTenantId(
      tenantId,
      { status: query.status, isPublic: query.isPublic },
      { limit: query.limit, cursor: query.cursor },
    );
  }

  public async createDefinition(
    tenantId: string,
    dto: CreatePresentationDefinitionDto,
    auth: AuthContext,
  ): Promise<VerificationProfile> {
    assertTenantAccess(auth, tenantId);
    assertSupportedPresentationQuery(dto.query);
    return this.create(
      tenantId,
      {
        name: dto.name,
        version: dto.version,
        description: dto.description,
        presentationDefinition: dto.query.presentationDefinition,
        predicates: dto.query.predicates,
      },
      auth,
      dto.options.format,
    );
  }

  public async updateDefinition(
    tenantId: string,
    id: string,
    dto: UpdatePresentationDefinitionDto,
    auth: AuthContext,
  ): Promise<VerificationProfile> {
    if (dto.query) assertSupportedPresentationQuery(dto.query);
    return this.update(
      tenantId,
      id,
      {
        description: dto.description,
        presentationDefinition: dto.query?.presentationDefinition,
        predicates: dto.query ? (dto.query.predicates ?? []) : undefined,
      },
      auth,
      dto.options?.format,
    );
  }

  public async create(
    tenantId: string,
    dto: CreateVerificationProfileDto,
    auth: AuthContext,
    presentationFormat?: CredentialDefinitionFormat,
  ): Promise<VerificationProfile> {
    assertTenantAccess(auth, tenantId);

    const requestedAttributes = extractRequestedAttributes(
      dto.presentationDefinition,
    );

    const existing =
      await this.verificationProfileRepository.findByNameAndVersion(
        tenantId,
        dto.name,
        dto.version,
      );

    if (existing) {
      throw new ConflictException(
        'Verification profile with this name and version already exists for this tenant.',
      );
    }

    const created = await this.createProfile({
      tenantId,
      name: dto.name,
      version: dto.version,
      description: dto.description,
      presentationDefinition: dto.presentationDefinition,
      ...(presentationFormat ? { presentationFormat } : {}),
      requestedAttributes,
      predicates: dto.predicates as unknown as
        Record<string, unknown>[] | undefined,
      metadata: dto.metadata ?? {},
      isPublic: dto.isPublic ?? false,
      protocolHint: dto.protocolHint,
    });

    await this.domainAudit.emit({
      tenantId: created.tenantId,
      action: AuditAction.CREATE,
      resourceType: 'verification_profile',
      resourceId: created.id,
    });

    return created;
  }

  /**
   * Inserts the profile, translating a losing race on the
   * `uq_verification_profile_tenant_name_version` constraint into the same
   * 409 the upfront findByNameAndVersion() check raises. Mirrors
   * IssuanceProfileService.createProfile.
   */
  private async createProfile(
    profile: Partial<VerificationProfile>,
  ): Promise<VerificationProfile> {
    try {
      return await this.verificationProfileRepository.create(profile);
    } catch (error) {
      if (
        isUniqueConstraintViolation(
          error,
          'uq_verification_profile_tenant_name_version',
        )
      ) {
        throw new ConflictException(
          'Verification profile with this name and version already exists for this tenant.',
        );
      }

      throw error;
    }
  }

  public async findById(
    tenantId: string,
    id: string,
    auth: AuthContext,
  ): Promise<VerificationProfile> {
    const profile = await this.verificationProfileRepository.findById(id);
    const notFound = `Verification profile '${id}' was not found.`;

    if (!profile || profile.tenantId !== tenantId) {
      throw new NotFoundException(notFound);
    }

    assertResourceTenantOrNotFound(auth, profile.tenantId, notFound);
    return profile;
  }

  public async findByTenantId(
    tenantId: string,
    filters: VerificationProfileFilters,
    options: { limit?: number; cursor?: string | null } = {},
  ): Promise<PaginatedVerificationProfiles> {
    const limit = options.limit ?? 20;
    const cursor = options.cursor ? decodeCursor(options.cursor) : null;

    const page = await this.verificationProfileRepository.findPage(
      tenantId,
      filters,
      { limit, cursor },
    );

    return {
      data: page.items,
      pagination: {
        next_cursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
        has_more: page.hasMore,
      },
    };
  }

  public async update(
    tenantId: string,
    id: string,
    dto: UpdateVerificationProfileDto,
    auth: AuthContext,
    presentationFormat?: CredentialDefinitionFormat,
  ): Promise<VerificationProfile> {
    const profile = await this.findById(tenantId, id, auth);

    if (profile.status !== VerificationProfileStatus.DRAFT) {
      throw new ConflictException(
        `Verification profile '${id}' cannot be updated because it is not in draft status.`,
      );
    }

    const patch: Partial<VerificationProfile> = {};

    if (presentationFormat !== undefined) {
      patch.presentationFormat = presentationFormat;
    }

    if (dto.presentationDefinition !== undefined) {
      const requestedAttributes = extractRequestedAttributes(
        dto.presentationDefinition,
      );
      patch.presentationDefinition = dto.presentationDefinition;
      patch.requestedAttributes = requestedAttributes;
    }

    if (dto.predicates !== undefined) {
      patch.predicates = dto.predicates as unknown as Record<string, unknown>[];
    }

    if (dto.description !== undefined) {
      patch.description = dto.description;
    }

    if (dto.metadata !== undefined) {
      patch.metadata = dto.metadata;
    }

    if (dto.isPublic !== undefined) {
      patch.isPublic = dto.isPublic;
    }

    if (dto.protocolHint !== undefined) {
      patch.protocolHint = dto.protocolHint;
    }

    const updatedWhileDraft =
      await this.verificationProfileRepository.updateIfDraft(
        tenantId,
        id,
        patch as QueryDeepPartialEntity<VerificationProfile>,
      );

    if (!updatedWhileDraft) {
      throw new ConflictException(
        `Verification profile '${id}' cannot be updated because it is not in draft status.`,
      );
    }

    const updated = await this.findById(tenantId, id, auth);

    await this.domainAudit.emit({
      tenantId: updated.tenantId,
      action: AuditAction.UPDATE,
      resourceType: 'verification_profile',
      resourceId: updated.id,
    });

    return updated;
  }

  public async publish(
    tenantId: string,
    id: string,
    auth: AuthContext,
  ): Promise<VerificationProfile> {
    const profile = await this.findById(tenantId, id, auth);

    if (profile.status !== VerificationProfileStatus.DRAFT) {
      throw new ConflictException(
        `Verification profile '${id}' cannot be published because it is not in draft status.`,
      );
    }

    const transitioned =
      await this.verificationProfileRepository.transitionStatus(
        tenantId,
        id,
        VerificationProfileStatus.DRAFT,
        VerificationProfileStatus.PUBLISHED,
      );

    if (!transitioned) {
      throw new ConflictException(
        `Verification profile '${id}' cannot be published because it is not in draft status.`,
      );
    }

    const published = await this.findById(tenantId, id, auth);

    await this.domainAudit.emit({
      tenantId: published.tenantId,
      action: AuditAction.UPDATE,
      resourceType: 'verification_profile',
      resourceId: published.id,
    });

    return published;
  }

  public async deprecate(
    tenantId: string,
    id: string,
    auth: AuthContext,
  ): Promise<VerificationProfile> {
    const profile = await this.findById(tenantId, id, auth);

    if (profile.status !== VerificationProfileStatus.PUBLISHED) {
      throw new ConflictException(
        `Verification profile '${id}' cannot be deprecated because it is not in published status.`,
      );
    }

    const transitioned =
      await this.verificationProfileRepository.transitionStatus(
        tenantId,
        id,
        VerificationProfileStatus.PUBLISHED,
        VerificationProfileStatus.DEPRECATED,
      );

    if (!transitioned) {
      throw new ConflictException(
        `Verification profile '${id}' cannot be deprecated because it is not in published status.`,
      );
    }

    const deprecated = await this.findById(tenantId, id, auth);

    await this.domainAudit.emit({
      tenantId: deprecated.tenantId,
      action: AuditAction.UPDATE,
      resourceType: 'verification_profile',
      resourceId: deprecated.id,
    });

    return deprecated;
  }
}
