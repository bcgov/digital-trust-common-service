import type { AuthContext } from '@app/auth';
import { AdapterError } from '@app/credential-ports';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import {
  assertResourceTenantOrNotFound,
  assertTenantAccess,
} from '../common/assert-tenant-access';
import { decodeCursor, encodeCursor } from '../common/cursor-pagination';
import { CredentialDefinitionFormat } from '../credential-definition/credential-definition.entity';
import {
  CredentialDefinitionService,
  toPortCredentialFormat,
} from '../credential-definition/credential-definition.service';

import { CreateIssuanceProfileDto } from './dto/create-issuance-profile.dto';
import { UpdateIssuanceProfileDto } from './dto/update-issuance-profile.dto';
import {
  IssuanceProfile,
  IssuanceProfileStatus,
} from './issuance-profile.entity';
import {
  IssuanceProfileCursor,
  IssuanceProfileFilters,
  IssuanceProfileRepository,
} from './issuance-profile.repository';

export type PaginatedIssuanceProfiles = {
  data: IssuanceProfile[];
  pagination: {
    next_cursor: string | null;
    has_more: boolean;
  };
};

@Injectable()
export class IssuanceProfileService {
  public constructor(
    private readonly issuanceProfileRepository: IssuanceProfileRepository,
    private readonly credentialDefinitionService: CredentialDefinitionService,
    private readonly adapterRegistry: AdapterRegistry,
    private readonly domainAudit: DomainAuditService,
  ) {}

  public async create(
    tenantId: string,
    dto: CreateIssuanceProfileDto,
    auth: AuthContext,
  ): Promise<IssuanceProfile> {
    assertTenantAccess(auth, tenantId);

    const credentialDefinition =
      await this.credentialDefinitionService.findById(
        tenantId,
        dto.credentialDefinitionId,
        auth,
      );

    this.validateAttributeSchema(
      credentialDefinition.format,
      credentialDefinition.schemaDefinition,
      dto.attributeSchema,
    );

    const existing = await this.issuanceProfileRepository.findByNameAndVersion(
      tenantId,
      dto.name,
      dto.version,
    );

    if (existing) {
      throw new ConflictException(
        'Issuance profile with this name and version already exists for this tenant.',
      );
    }

    const connectorId = await this.resolveConnector(
      tenantId,
      credentialDefinition.format,
      dto.connectorId,
    );

    const created = await this.createProfile({
      tenantId,
      name: dto.name,
      version: dto.version,
      description: dto.description,
      credentialDefinitionId: credentialDefinition.id,
      format: credentialDefinition.format,
      connectorId,
      attributeSchema: dto.attributeSchema,
      defaults: dto.defaults,
      display: dto.display,
      metadata: dto.metadata,
      protocolHint: dto.protocolHint,
    });

    await this.domainAudit.emit({
      tenantId: created.tenantId,
      action: AuditAction.CREATE,
      resourceType: 'issuance_profile',
      resourceId: created.id,
    });

    return created;
  }

  /**
   * Inserts the profile, translating a losing race on the
   * `uq_issuance_profile_tenant_name_version` constraint into the same 409
   * the upfront findByNameAndVersion() check raises. That check is a
   * read-then-insert and cannot itself close the race between two
   * concurrent creates for the same (tenant, name, version); the database
   * constraint is the actual source of truth.
   */
  private async createProfile(
    profile: Partial<IssuanceProfile>,
  ): Promise<IssuanceProfile> {
    try {
      return await this.issuanceProfileRepository.create(profile);
    } catch (error) {
      if (this.isUniqueConstraintViolation(error)) {
        throw new ConflictException(
          'Issuance profile with this name and version already exists for this tenant.',
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
      driverError?.constraint === 'uq_issuance_profile_tenant_name_version'
    );
  }

  /**
   * Validates attribute_schema's declared attribute names against the
   * credential definition's schema_definition, when the format has a
   * checkable shape. AnonCreds is the only format with structured schema
   * data today (schema_definition.attr_names); other formats (SD-JWT, mDL,
   * W3C VC) accept attribute_schema as-is until their own validators ship,
   * matching CredentialDefinitionService's own "no validator yet" handling.
   */
  private validateAttributeSchema(
    format: CredentialDefinitionFormat,
    schemaDefinition: Readonly<Record<string, unknown>>,
    attributeSchema: Readonly<Record<string, unknown>>,
  ): void {
    if (format !== CredentialDefinitionFormat.ANONCREDS) {
      return;
    }

    const attrNames = schemaDefinition.attr_names;

    if (!Array.isArray(attrNames)) {
      return;
    }

    const allowed = new Set(attrNames);
    const unknownAttributes = Object.keys(attributeSchema).filter(
      (name) => !allowed.has(name),
    );

    if (unknownAttributes.length > 0) {
      throw new BadRequestException(
        `attribute_schema declares attributes not present in the credential definition schema: ${unknownAttributes.join(', ')}`,
      );
    }
  }

  /**
   * Resolves the connector to bind this profile to and validates it
   * supports the credential definition's format. AdapterRegistry.resolve()
   * already falls back to tenant.config.default_connector when connectorId
   * is omitted, so that fallback is not duplicated here. AdapterError
   * (FormatNotSupportedError, ConnectorUnavailableError) is treated as a
   * client-input problem, not a server error.
   *
   * A format the port layer does not know (no toPortCredentialFormat
   * mapping) is rejected explicitly rather than passed through as
   * `undefined`: AdapterRegistry.resolve() treats an undefined format as
   * "nothing to check", which would silently bind the profile to a
   * connector that never advertised support for it.
   */
  private async resolveConnector(
    tenantId: string,
    format: CredentialDefinitionFormat,
    connectorId?: string,
  ): Promise<string> {
    const portFormat = toPortCredentialFormat(format);

    if (!portFormat) {
      throw new BadRequestException(
        `Credential format '${format}' does not yet support connector compatibility validation.`,
      );
    }

    try {
      const resolved = await this.adapterRegistry.resolve(
        tenantId,
        portFormat,
        {
          connectorId,
        },
      );

      return resolved.connector.id;
    } catch (error) {
      if (error instanceof AdapterError) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }
  }

  public async findById(
    tenantId: string,
    id: string,
    auth: AuthContext,
  ): Promise<IssuanceProfile> {
    const profile = await this.issuanceProfileRepository.findById(id);
    const notFound = `Issuance profile '${id}' was not found.`;

    if (!profile || profile.tenantId !== tenantId) {
      throw new NotFoundException(notFound);
    }

    assertResourceTenantOrNotFound(auth, profile.tenantId, notFound);
    return profile;
  }

  public async findByTenantId(
    tenantId: string,
    filters: IssuanceProfileFilters,
    options: { limit?: number; cursor?: string | null } = {},
  ): Promise<PaginatedIssuanceProfiles> {
    const limit = options.limit ?? 20;
    const cursor = options.cursor ? this.decodeCursor(options.cursor) : null;

    const page = await this.issuanceProfileRepository.findPage(
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

  public encodeCursor(cursor: IssuanceProfileCursor): string {
    return encodeCursor(cursor);
  }

  public decodeCursor(raw: string): IssuanceProfileCursor {
    return decodeCursor(raw);
  }

  public async update(
    tenantId: string,
    id: string,
    dto: UpdateIssuanceProfileDto,
    auth: AuthContext,
  ): Promise<IssuanceProfile> {
    const profile = await this.findById(tenantId, id, auth);

    if (profile.status !== IssuanceProfileStatus.DRAFT) {
      throw new ConflictException(
        `Issuance profile '${id}' cannot be updated because it is not in draft status.`,
      );
    }

    if (dto.description !== undefined) {
      profile.description = dto.description;
    }

    if (dto.defaults !== undefined) {
      profile.defaults = dto.defaults;
    }

    if (dto.display !== undefined) {
      profile.display = dto.display;
    }

    if (dto.metadata !== undefined) {
      profile.metadata = dto.metadata;
    }

    if (dto.protocolHint !== undefined) {
      profile.protocolHint = dto.protocolHint;
    }

    const updated = await this.issuanceProfileRepository.save(profile);

    await this.domainAudit.emit({
      tenantId: updated.tenantId,
      action: AuditAction.UPDATE,
      resourceType: 'issuance_profile',
      resourceId: updated.id,
    });

    return updated;
  }

  /**
   * Publishes a draft profile, making it eligible for issuance. `format`,
   * `credential_definition_id`, and `attribute_schema` are already
   * immutable once a profile leaves draft, since `update()` never permits
   * changing them at any status.
   *
   * "Healthy connector" is interpreted as: the connector this profile was
   * bound to at create time still exists, is active, and its adapter still
   * resolves. There is no live connectivity/health-check port in this
   * codebase, so this re-runs the same `AdapterRegistry.resolve` call
   * `create()` used, rather than a network probe.
   */
  public async publish(
    tenantId: string,
    id: string,
    auth: AuthContext,
  ): Promise<IssuanceProfile> {
    const profile = await this.findById(tenantId, id, auth);

    if (profile.status !== IssuanceProfileStatus.DRAFT) {
      throw new ConflictException(
        `Issuance profile '${id}' cannot be published because it is not in draft status.`,
      );
    }

    const connectorId = await this.assertConnectorHealthy(profile);

    const transitioned = await this.issuanceProfileRepository.transitionStatus(
      tenantId,
      id,
      IssuanceProfileStatus.DRAFT,
      IssuanceProfileStatus.PUBLISHED,
      connectorId,
    );

    if (!transitioned) {
      throw new ConflictException(
        `Issuance profile '${id}' cannot be published because it is not in draft status.`,
      );
    }

    const published = await this.findById(tenantId, id, auth);

    await this.domainAudit.emit({
      tenantId: published.tenantId,
      action: AuditAction.UPDATE,
      resourceType: 'issuance_profile',
      resourceId: published.id,
    });

    return published;
  }

  /**
   * Deprecates a published profile. Blocking new issuance from a deprecated
   * profile, and any effect on already-issued credentials, is out of scope
   * here: neither concern is enforced by anything in this codebase yet.
   */
  public async deprecate(
    tenantId: string,
    id: string,
    auth: AuthContext,
  ): Promise<IssuanceProfile> {
    const profile = await this.findById(tenantId, id, auth);

    if (profile.status !== IssuanceProfileStatus.PUBLISHED) {
      throw new ConflictException(
        `Issuance profile '${id}' cannot be deprecated because it is not in published status.`,
      );
    }

    const transitioned = await this.issuanceProfileRepository.transitionStatus(
      tenantId,
      id,
      IssuanceProfileStatus.PUBLISHED,
      IssuanceProfileStatus.DEPRECATED,
    );

    if (!transitioned) {
      throw new ConflictException(
        `Issuance profile '${id}' cannot be deprecated because it is not in published status.`,
      );
    }

    const deprecated = await this.findById(tenantId, id, auth);

    await this.domainAudit.emit({
      tenantId: deprecated.tenantId,
      action: AuditAction.UPDATE,
      resourceType: 'issuance_profile',
      resourceId: deprecated.id,
    });

    return deprecated;
  }

  /**
   * Rejects publish when the profile's bound connector was removed
   * (`connectorId` is null after an `ON DELETE SET NULL`) or no longer
   * resolves. `connectorId` is passed explicitly rather than left
   * undefined, so this does not fall back to a different connector the
   * profile was never bound to.
   *
   * Returns the validated connector id so the caller can pin the guarded
   * status transition to it via `transitionStatus`'s `expectedConnectorId`,
   * closing the window between this check and that update: a connector
   * change or removal in between makes the guard no longer match instead
   * of silently publishing against an unrevalidated connector.
   */
  private async assertConnectorHealthy(
    profile: IssuanceProfile,
  ): Promise<string> {
    if (!profile.connectorId) {
      throw new BadRequestException(
        `Issuance profile '${profile.id}' cannot be published because its connector no longer exists.`,
      );
    }

    await this.resolveConnector(
      profile.tenantId,
      profile.format,
      profile.connectorId,
    );

    return profile.connectorId;
  }
}
