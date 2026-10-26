import type { AuthContext } from '@app/auth';
import {
  AdapterError,
  CredentialFormat,
  FormatNotSupportedError,
  FormatValidatorRegistry,
} from '@app/credential-ports';
import { JOB_QUEUES } from '@app/pg-boss';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';
import { DataSource, QueryFailedError } from 'typeorm';

import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import {
  assertResourceTenantOrNotFound,
  assertTenantAccess,
} from '../common/assert-tenant-access';
import { API_BASE_PATH } from '../common/constants/api-version.constants';
import { RegistrationBackendError } from '../common/registration-backend-error';
import { JobsService } from '../jobs/jobs.service';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { Operation, OperationState } from '../operation/operation.entity';
import { OperationService } from '../operation/operation.service';

import {
  CREDENTIAL_DEFINITION_FORMAT_HANDLERS,
  type CredentialDefinitionFormatHandler,
} from './credential-definition-format-handler';
import {
  CredentialDefinition,
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
} from './credential-definition.entity';
import { CredentialDefinitionRepository } from './credential-definition.repository';
import { CreateCredentialDefinitionDto } from './dto/create-credential-definition.dto';
import { UpdateCredentialDefinitionDto } from './dto/update-credential-definition.dto';
import { registrationFingerprints } from './registration-fingerprint';

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
  const formats: Partial<Record<CredentialDefinitionFormat, CredentialFormat>> =
    {
      [CredentialDefinitionFormat.ANONCREDS]: CredentialFormat.AnonCreds,
      [CredentialDefinitionFormat.SD_JWT]: CredentialFormat.SdJwtVc,
      [CredentialDefinitionFormat.MDL]: CredentialFormat.Mdl,
      [CredentialDefinitionFormat.W3C_VC]: CredentialFormat.JsonLd,
    };

  return formats[format];
}

@Injectable()
export class CredentialDefinitionService {
  public constructor(
    private readonly credentialDefinitionRepository: CredentialDefinitionRepository,
    private readonly domainAudit: DomainAuditService,
    private readonly formatValidatorRegistry: FormatValidatorRegistry,
    private readonly operations: OperationService,
    private readonly jobs: JobsService,
    private readonly dataSource: DataSource,
    @Inject(CREDENTIAL_DEFINITION_FORMAT_HANDLERS)
    private readonly formatHandlers: CredentialDefinitionFormatHandler[],
  ) {}

  public async create(
    tenantId: string,
    dto: CreateCredentialDefinitionDto,
    auth: AuthContext,
  ): Promise<Operation> {
    assertTenantAccess(auth, tenantId);
    const handler = this.formatHandlers.find(
      (candidate) => candidate.format === dto.format,
    );
    if (!handler) {
      this.registrationError(new FormatNotSupportedError(dto.format));
    }
    const options = handler.normalizeOptions(dto.options);
    const prepared = await handler
      .prepare(tenantId, dto)
      .catch((error: unknown) => this.registrationError(error));
    this.validateSchemaDefinition(dto.format, prepared.schemaDefinition);
    const fingerprints = registrationFingerprints(
      {
        tenantId,
        connectorId: prepared.connectorId,
        issuerId: prepared.registration?.issuerId ?? '',
        format: dto.format,
        schema: {
          id: prepared.registration?.schemaId,
          definition: prepared.schemaDefinition,
        },
        options,
      },
      dto.name,
      dto.metadata,
    );

    const { created, operation } = await this.dataSource
      .transaction(async (manager) => {
        await manager.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`${tenantId}:${fingerprints.artifact}:registration-intent`],
        );
        const replay =
          await this.credentialDefinitionRepository.findByFingerprint(
            tenantId,
            'requestFingerprint',
            fingerprints.request,
            manager,
          );
        if (replay) {
          if (
            !replay.isActive &&
            replay.registrationState === 'failed' &&
            replay.registration &&
            !replay.registration.publicationOutcomeUnknown
          ) {
            const operation = await this.operations.createOperation(
              {
                tenantId,
                type: OPERATION_TYPE.CREDENTIAL_DEFINITION_REGISTER,
                request: {
                  method: 'POST',
                  path: `${API_BASE_PATH}/tenants/${tenantId}/credential-definitions`,
                  body: { name: dto.name, format: dto.format },
                },
              },
              manager,
            );
            const registration = { ...replay.registration };
            delete registration.retryAfter;
            await manager.update(
              CredentialDefinition,
              { id: replay.id, tenantId, isActive: false },
              {
                isActive: true,
                registrationState: 'pending',
                registrationOperationId: operation.id,
                registration: { ...registration, retryCount: 0 },
              },
            );
            operation.result = { credential_definition_id: replay.id };
            await manager.save(Operation, operation);
            await this.jobs.sendInTransaction(
              manager,
              JOB_QUEUES.DEFINITION_REGISTER,
              {
                tenantId,
                definitionId: replay.id,
              },
            );
            replay.isActive = true;
            replay.registrationState = 'pending';
            replay.registrationOperationId = operation.id;
            replay.registration = { ...registration, retryCount: 0 };
            return { created: replay, operation };
          }
          const operation = replay.registrationOperationId
            ? await manager.findOne(Operation, {
                where: { tenantId, id: replay.registrationOperationId },
              })
            : null;
          if (!replay.isActive || !operation) {
            throw new ConflictException({
              code: 'REGISTRATION_REPLAY_UNAVAILABLE',
              message:
                'Registration exists but is inactive or cannot be retried safely',
              credential_definition_id: replay.id,
            });
          }
          return { created: undefined, operation };
        }
        const artifact =
          await this.credentialDefinitionRepository.findByFingerprint(
            tenantId,
            'artifactFingerprint',
            fingerprints.artifact,
            manager,
          );
        if (artifact) {
          throw new ConflictException({
            code: 'REGISTRATION_ARTIFACT_EXISTS',
            message:
              'These artifacts already have a registration; use its existing operation',
            credential_definition_id: artifact.id,
            operation_id: artifact.registrationOperationId,
          });
        }
        const existing =
          await this.credentialDefinitionRepository.findByTenantAndNameAndFormat(
            tenantId,
            dto.name,
            dto.format,
            manager,
          );
        if (existing) {
          throw new ConflictException(
            'Credential definition with this name and format already exists for this tenant.',
          );
        }
        const operation = await this.operations.createOperation(
          {
            tenantId,
            type: OPERATION_TYPE.CREDENTIAL_DEFINITION_REGISTER,
            request: {
              method: 'POST',
              path: `${API_BASE_PATH}/tenants/${tenantId}/credential-definitions`,
              body: { name: dto.name, format: dto.format },
            },
          },
          manager,
        );
        const created = await this.credentialDefinitionRepository.create(
          {
            tenantId,
            name: dto.name,
            format: dto.format,
            connectorId: prepared.connectorId,
            connectorType: prepared.connectorType,
            schemaDefinition: prepared.schemaDefinition,
            externalId: null,
            metadata: dto.metadata,
            options,
            registrationState: 'pending',
            registrationOperationId: operation.id,
            requestFingerprint: fingerprints.request,
            artifactFingerprint: fingerprints.artifact,
            registration: prepared.registration,
          },
          manager,
        );
        operation.result = { credential_definition_id: created.id };
        await manager.save(Operation, operation);
        await handler.register(created, manager);
        if (created.registrationState === 'ready') {
          const completedOperation = await this.operations.transitionState(
            operation.id,
            OperationState.COMPLETED,
            operation.result,
            manager,
            tenantId,
          );
          Object.assign(operation, completedOperation);
        }
        return { created, operation };
      })
      .catch((error: unknown) => {
        const driver: unknown =
          error instanceof QueryFailedError ? error.driverError : null;
        if (
          typeof driver === 'object' &&
          driver !== null &&
          'code' in driver &&
          driver.code === '23505'
        ) {
          throw new ConflictException('Credential definition already exists');
        }
        throw error;
      });

    if (created) {
      await this.domainAudit.emit({
        tenantId: created.tenantId,
        action: AuditAction.CREATE,
        resourceType: 'credential_definition',
        resourceId: created.id,
      });
    }

    return operation;
  }

  private registrationError(error: unknown): never {
    if (error instanceof RegistrationBackendError) {
      if (
        error.status &&
        error.status >= 400 &&
        error.status < 500 &&
        ![408, 429].includes(error.status)
      ) {
        throw new BadRequestException({
          code: 'REGISTRATION_BACKEND_REJECTED',
          message: error.detail,
          backend_status: error.status,
          ...(error.backendCode ? { backend_code: error.backendCode } : {}),
        });
      }
      throw new ServiceUnavailableException(
        'Traction registration service is unavailable',
      );
    }
    if (error instanceof AdapterError) {
      throw new BadRequestException({
        code: error.code,
        message: error.message,
        ...error.context,
      });
    }
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status && status >= 400 && status < 500 && status !== 429) {
        throw new BadRequestException(
          'Traction could not resolve the requested issuer or schema',
        );
      }
      throw new ServiceUnavailableException(
        'Traction registration service is unavailable',
      );
    }
    throw error;
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
    tenantId: string,
    id: string,
    auth: AuthContext,
  ): Promise<CredentialDefinition> {
    const credentialDefinition =
      await this.credentialDefinitionRepository.findById(id);
    const notFound = `Credential definition '${id}' was not found.`;

    if (!credentialDefinition || credentialDefinition.tenantId !== tenantId) {
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
    tenantId: string,
    format: CredentialDefinitionFormat,
  ): Promise<CredentialDefinition[]> {
    return await this.credentialDefinitionRepository.findByFormat(
      format,
      tenantId,
    );
  }

  public async findByConnector(
    tenantId: string,
    connectorType: CredentialDefinitionConnectorType,
  ): Promise<CredentialDefinition[]> {
    return await this.credentialDefinitionRepository.findByConnector(
      connectorType,
      tenantId,
    );
  }

  public async update(
    tenantId: string,
    id: string,
    dto: UpdateCredentialDefinitionDto,
    auth: AuthContext,
  ): Promise<CredentialDefinition> {
    await this.findById(tenantId, id, auth);
    const changes: Partial<Pick<CredentialDefinition, 'name' | 'metadata'>> =
      {};
    if (dto.name !== undefined) changes.name = dto.name;
    if (dto.metadata !== undefined) {
      changes.metadata = dto.metadata;
    }
    const updated =
      await this.credentialDefinitionRepository.updateEditableFields(
        tenantId,
        id,
        changes,
      );
    if (!updated) {
      throw new NotFoundException(
        `Credential definition '${id}' was not found.`,
      );
    }

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
   * `credential_definition_id`) keep resolving. `findById` only resolves
   * active definitions, so calling delete on an already-deactivated
   * definition is a 404, preventing duplicate audit events.
   */
  public async delete(
    tenantId: string,
    id: string,
    auth: AuthContext,
  ): Promise<void> {
    const credentialDefinition = await this.findById(tenantId, id, auth);

    await this.credentialDefinitionRepository.deactivate(id);

    await this.domainAudit.emit({
      tenantId: credentialDefinition.tenantId,
      action: AuditAction.UPDATE,
      resourceType: 'credential_definition',
      resourceId: id,
    });
  }
}
