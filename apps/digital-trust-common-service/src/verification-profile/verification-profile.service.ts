import type { AuthContext } from '@app/auth';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import {
  assertResourceTenantOrNotFound,
  assertTenantAccess,
} from '../common/assert-tenant-access';
import { IssuanceProfileStatus } from '../issuance-profile/issuance-profile.entity';
import { IssuanceProfileService } from '../issuance-profile/issuance-profile.service';

import { CreateVerificationProfileDto } from './dto/create-verification-profile.dto';
import { UpdateVerificationProfileDto } from './dto/update-verification-profile.dto';
import { VerificationPredicateDto } from './dto/verification-predicate.dto';
import {
  VerificationProfile,
  VerificationProfileStatus,
} from './verification-profile.entity';
import {
  VerificationProfileCursor,
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

/** Attribute schema `type` values treated as numeric for predicate validation. */
const NUMERIC_ATTRIBUTE_TYPES = new Set([
  'number',
  'integer',
  'date',
  'datetime',
]);

@Injectable()
export class VerificationProfileService {
  public constructor(
    private readonly verificationProfileRepository: VerificationProfileRepository,
    private readonly issuanceProfileService: IssuanceProfileService,
    private readonly domainAudit: DomainAuditService,
  ) {}

  public async create(
    tenantId: string,
    dto: CreateVerificationProfileDto,
    auth: AuthContext,
  ): Promise<VerificationProfile> {
    assertTenantAccess(auth, tenantId);

    const issuanceProfile = await this.issuanceProfileService.findById(
      tenantId,
      dto.issuanceProfileId,
      auth,
    );

    if (issuanceProfile.status !== IssuanceProfileStatus.PUBLISHED) {
      throw new BadRequestException(
        `Issuance profile '${dto.issuanceProfileId}' must be published before it can back a verification profile.`,
      );
    }

    const requestedAttributes = this.extractRequestedAttributes(
      dto.presentationDefinition,
    );

    this.validateRequestedAttributes(
      issuanceProfile.attributeSchema,
      requestedAttributes,
    );
    this.validatePredicates(
      issuanceProfile.attributeSchema,
      dto.predicates ?? [],
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
      issuanceProfileId: issuanceProfile.id,
      name: dto.name,
      version: dto.version,
      description: dto.description,
      presentationDefinition: dto.presentationDefinition,
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
      if (this.isUniqueConstraintViolation(error)) {
        throw new ConflictException(
          'Verification profile with this name and version already exists for this tenant.',
        );
      }

      throw error;
    }
  }

  private isUniqueConstraintViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = error.driverError as
      { code?: string; constraint?: string } | undefined;

    return (
      driverError?.code === '23505' &&
      driverError?.constraint === 'uq_verification_profile_tenant_name_version'
    );
  }

  /**
   * Extracts attribute names referenced by a DIF Presentation Exchange
   * `presentation_definition`, from each input descriptor's
   * `constraints.fields[].path` JSONPath entries (e.g.
   * `$.credentialSubject.given_names` -> `given_names`). Used both to
   * validate against the issuance profile's attribute_schema and to
   * populate the `requested_attributes` quick-reference column.
   */
  private extractRequestedAttributes(
    presentationDefinition: Record<string, unknown>,
  ): string[] {
    const inputDescriptors = presentationDefinition.input_descriptors;

    if (!Array.isArray(inputDescriptors) || inputDescriptors.length === 0) {
      throw new BadRequestException(
        'presentation_definition must be a DIF Presentation Exchange object with a non-empty input_descriptors array.',
      );
    }

    const names = new Set<string>();

    for (const descriptor of inputDescriptors) {
      if (
        !descriptor ||
        typeof descriptor !== 'object' ||
        typeof (descriptor as { id?: unknown }).id !== 'string'
      ) {
        throw new BadRequestException(
          "Each presentation_definition input_descriptor must declare a string 'id'.",
        );
      }

      const fields = (descriptor as { constraints?: { fields?: unknown } })
        .constraints?.fields;

      if (!Array.isArray(fields)) {
        continue;
      }

      for (const field of fields) {
        const paths = (field as { path?: unknown } | undefined)?.path;

        if (!Array.isArray(paths)) {
          continue;
        }

        for (const path of paths) {
          if (typeof path !== 'string') {
            continue;
          }

          const match = /([^.[\]]+)$/.exec(path);

          if (match) {
            names.add(match[1]);
          }
        }
      }
    }

    return [...names];
  }

  private validateRequestedAttributes(
    attributeSchema: Readonly<Record<string, unknown>>,
    requestedAttributes: string[],
  ): void {
    const allowed = new Set(Object.keys(attributeSchema));
    const unknownAttributes = requestedAttributes.filter(
      (name) => !allowed.has(name),
    );

    if (unknownAttributes.length > 0) {
      throw new BadRequestException(
        `presentation_definition requests attributes not present in the issuance profile's attribute_schema: ${unknownAttributes.join(', ')}`,
      );
    }
  }

  /**
   * Validates that each predicate references an attribute declared on the
   * issuance profile, and, where the attribute_schema declares a `type`,
   * that the predicate's value is shape-compatible with it (numeric types
   * require a parseable numeric value).
   */
  private validatePredicates(
    attributeSchema: Readonly<Record<string, unknown>>,
    predicates: VerificationPredicateDto[],
  ): void {
    const allowed = new Set(Object.keys(attributeSchema));

    for (const predicate of predicates) {
      if (!allowed.has(predicate.attribute)) {
        throw new BadRequestException(
          `Predicate references an attribute not present in the issuance profile's attribute_schema: '${predicate.attribute}'.`,
        );
      }

      const declared = attributeSchema[predicate.attribute];
      const declaredType =
        declared && typeof declared === 'object'
          ? (declared as { type?: unknown }).type
          : undefined;

      if (
        typeof declaredType === 'string' &&
        NUMERIC_ATTRIBUTE_TYPES.has(declaredType.toLowerCase()) &&
        Number.isNaN(Number(predicate.value))
      ) {
        throw new BadRequestException(
          `Predicate value for attribute '${predicate.attribute}' must be numeric to match its declared type '${declaredType}'.`,
        );
      }
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
    const cursor = options.cursor ? this.decodeCursor(options.cursor) : null;

    const page = await this.verificationProfileRepository.findPage(
      tenantId,
      filters,
      { limit, cursor },
    );

    return {
      data: page.items,
      pagination: {
        next_cursor: page.nextCursor
          ? this.encodeCursor(page.nextCursor)
          : null,
        has_more: page.hasMore,
      },
    };
  }

  public encodeCursor(cursor: VerificationProfileCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }

  public decodeCursor(raw: string): VerificationProfileCursor {
    try {
      const parsed = JSON.parse(
        Buffer.from(raw, 'base64url').toString('utf8'),
      ) as VerificationProfileCursor;

      if (!parsed?.createdAt || !parsed?.id) {
        throw new Error('invalid cursor shape');
      }

      return parsed;
    } catch {
      throw new BadRequestException('Invalid pagination cursor.');
    }
  }

  public async update(
    tenantId: string,
    id: string,
    dto: UpdateVerificationProfileDto,
    auth: AuthContext,
  ): Promise<VerificationProfile> {
    const profile = await this.findById(tenantId, id, auth);

    if (profile.status !== VerificationProfileStatus.DRAFT) {
      throw new ConflictException(
        `Verification profile '${id}' cannot be updated because it is not in draft status.`,
      );
    }

    if (
      dto.presentationDefinition !== undefined ||
      dto.predicates !== undefined
    ) {
      const issuanceProfile = await this.issuanceProfileService.findById(
        tenantId,
        profile.issuanceProfileId,
        auth,
      );

      if (dto.presentationDefinition !== undefined) {
        const requestedAttributes = this.extractRequestedAttributes(
          dto.presentationDefinition,
        );
        this.validateRequestedAttributes(
          issuanceProfile.attributeSchema,
          requestedAttributes,
        );
        profile.presentationDefinition = dto.presentationDefinition;
        profile.requestedAttributes = requestedAttributes;
      }

      if (dto.predicates !== undefined) {
        this.validatePredicates(
          issuanceProfile.attributeSchema,
          dto.predicates,
        );
        profile.predicates = dto.predicates as unknown as Record<
          string,
          unknown
        >[];
      }
    }

    if (dto.description !== undefined) {
      profile.description = dto.description;
    }

    if (dto.metadata !== undefined) {
      profile.metadata = dto.metadata;
    }

    if (dto.isPublic !== undefined) {
      profile.isPublic = dto.isPublic;
    }

    if (dto.protocolHint !== undefined) {
      profile.protocolHint = dto.protocolHint;
    }

    const updated = await this.verificationProfileRepository.save(profile);

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
