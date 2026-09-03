import type { AuthContext } from '@app/auth';
import {
  CredentialFormat,
  FormatValidatorRegistry,
} from '@app/credential-ports';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import {
  assertResourceTenantOrNotFound,
  assertTenantAccess,
  isPlatformAdmin,
} from '../common/assert-tenant-access';

import {
  CredentialDefinition,
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
} from './credential-definition.entity';
import { CredentialDefinitionRepository } from './credential-definition.repository';
import { CreateCredentialDefinitionDto } from './dto/create-credential-definition.dto';
import { UpdateCredentialDefinitionDto } from './dto/update-credential-definition.dto';

/**
 * Maps the `format` stored on credential definitions onto the port-layer
 * enum. The two enums are maintained independently: the entity enum covers
 * every format this API accepts, while the port enum only lists formats
 * that have a validator (or adapter) implementation. Returns undefined for
 * a value the port layer does not know, since the string values are not
 * guaranteed to match (e.g. entity 'sd-jwt' vs. port 'sd-jwt-vc').
 */
export function toPortCredentialFormat(
  format: CredentialDefinitionFormat,
): CredentialFormat | undefined {
  const candidate: string = format;

  return Object.values(CredentialFormat).find(
    (value) => (value as string) === candidate,
  );
}

@Injectable()
export class CredentialDefinitionService {
  public constructor(
    private readonly credentialDefinitionRepository: CredentialDefinitionRepository,
    private readonly domainAudit: DomainAuditService,
    private readonly formatValidatorRegistry: FormatValidatorRegistry,
  ) {}

  public async create(
    dto: CreateCredentialDefinitionDto,
    auth: AuthContext,
  ): Promise<CredentialDefinition> {
    assertTenantAccess(auth, dto.tenantId);

    const existing =
      await this.credentialDefinitionRepository.findByTenantAndNameAndFormat(
        dto.tenantId,
        dto.name,
        dto.format,
      );

    if (existing) {
      throw new ConflictException(
        'Credential definition with this name and format already exists for this tenant.',
      );
    }

    this.validateSchemaDefinition(dto.format, dto.schemaDefinition);

    const created = await this.credentialDefinitionRepository.create({
      tenantId: dto.tenantId,
      name: dto.name,
      format: dto.format,
      schemaDefinition: dto.schemaDefinition,
      externalId: dto.externalId,
      connectorType: dto.connectorType,
      metadata: dto.metadata,
    });

    await this.domainAudit.emit({
      tenantId: created.tenantId,
      action: AuditAction.CREATE,
      resourceType: 'credential_definition',
      resourceId: created.id,
    });

    return created;
  }

  /**
   * Validates the schema definition against the format's structural rules
   * when a FormatValidator is registered for it. Formats without a
   * registered validator yet (e.g. SD-JWT, mDL, W3C VC) are accepted
   * as-is until their own validator ships.
   */
  private validateSchemaDefinition(
    format: CredentialDefinitionFormat,
    schemaDefinition: Readonly<Record<string, unknown>>,
  ): void {
    const portFormat = toPortCredentialFormat(format);

    if (!portFormat || !this.formatValidatorRegistry.has(portFormat)) {
      return;
    }

    const issues = this.formatValidatorRegistry
      .resolve(portFormat)
      .validateSchema(schemaDefinition);

    if (issues.length > 0) {
      throw new BadRequestException({
        message: 'Credential definition schema failed format validation',
        issues,
      });
    }
  }

  public async findById(
    id: string,
    auth: AuthContext,
  ): Promise<CredentialDefinition> {
    const credentialDefinition =
      await this.credentialDefinitionRepository.findById(id);
    const notFound = `Credential definition '${id}' was not found.`;

    if (!credentialDefinition) {
      throw new NotFoundException(notFound);
    }

    assertResourceTenantOrNotFound(
      auth,
      credentialDefinition.tenantId,
      notFound,
    );
    return credentialDefinition;
  }

  public async findByTenantId(
    tenantId: string,
  ): Promise<CredentialDefinition[]> {
    return await this.credentialDefinitionRepository.findByTenantId(tenantId);
  }

  public async findByFormat(
    format: CredentialDefinitionFormat,
    auth: AuthContext,
  ): Promise<CredentialDefinition[]> {
    if (isPlatformAdmin(auth)) {
      return await this.credentialDefinitionRepository.findByFormat(format);
    }

    if (!auth.tenantId) {
      return [];
    }

    return await this.credentialDefinitionRepository.findByFormat(
      format,
      auth.tenantId,
    );
  }

  public async findByConnector(
    connectorType: CredentialDefinitionConnectorType,
    auth: AuthContext,
  ): Promise<CredentialDefinition[]> {
    if (isPlatformAdmin(auth)) {
      return await this.credentialDefinitionRepository.findByConnector(
        connectorType,
      );
    }

    if (!auth.tenantId) {
      return [];
    }

    return await this.credentialDefinitionRepository.findByConnector(
      connectorType,
      auth.tenantId,
    );
  }

  public async update(
    id: string,
    dto: UpdateCredentialDefinitionDto,
    auth: AuthContext,
  ): Promise<CredentialDefinition> {
    const credentialDefinition = await this.findById(id, auth);

    if (dto.name !== undefined) {
      credentialDefinition.name = dto.name;
    }

    if (dto.metadata !== undefined) {
      credentialDefinition.metadata = dto.metadata;
    }

    const updated =
      await this.credentialDefinitionRepository.update(credentialDefinition);

    await this.domainAudit.emit({
      tenantId: updated.tenantId,
      action: AuditAction.UPDATE,
      resourceType: 'credential_definition',
      resourceId: updated.id,
    });

    return updated;
  }

  /**
   * Deactivates the credential definition rather than deleting its row, so
   * that records referencing its id (e.g. an issuance profile's
   * `credential_definition_id`) keep resolving.
   */
  public async delete(id: string, auth: AuthContext): Promise<void> {
    const credentialDefinition = await this.findById(id, auth);

    await this.credentialDefinitionRepository.deactivate(id);

    await this.domainAudit.emit({
      tenantId: credentialDefinition.tenantId,
      action: AuditAction.UPDATE,
      resourceType: 'credential_definition',
      resourceId: id,
    });
  }
}
