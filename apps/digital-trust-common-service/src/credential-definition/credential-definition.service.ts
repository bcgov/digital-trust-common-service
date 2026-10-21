import type { AuthContext } from '@app/auth';
import {
  AdapterError,
  CredentialFormat,
  FormatValidatorRegistry,
} from '@app/credential-ports';
import { JOB_QUEUES } from '@app/pg-boss';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';
import { DataSource, QueryFailedError } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
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
  CredentialDefinition,
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
} from './credential-definition.entity';
import { CredentialDefinitionRepository } from './credential-definition.repository';
import { CreateCredentialDefinitionDto } from './dto/create-credential-definition.dto';
import { RecoverCredentialDefinitionDto } from './dto/recover-credential-definition.dto';
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
    private readonly adapters: AdapterRegistry,
    private readonly operations: OperationService,
    private readonly jobs: JobsService,
    private readonly dataSource: DataSource,
  ) {}

  public async create(
    tenantId: string,
    dto: CreateCredentialDefinitionDto,
    auth: AuthContext,
  ): Promise<Operation> {
    assertTenantAccess(auth, tenantId);
    if (dto.format !== CredentialDefinitionFormat.ANONCREDS) {
      throw new BadRequestException('Only AnonCreds registration is supported');
    }
    if (
      !dto.schema ||
      (dto.schema.id !== undefined) === (dto.schema.definition !== undefined)
    ) {
      throw new BadRequestException(
        'Supply schema.id or schema.definition, not both',
      );
    }
    if (
      dto.issuer &&
      (dto.issuer.id !== undefined) === (dto.issuer.method !== undefined)
    ) {
      throw new BadRequestException(
        'Supply issuer.id or issuer.method, not both',
      );
    }

    const resolved = await this.adapters
      .resolve(tenantId, CredentialFormat.AnonCreds, {
        connectorId: dto.connectorId,
      })
      .catch((error: unknown) => this.registrationError(error));
    const registration = resolved.adapter.definitionRegistration;
    if (!registration) {
      throw new BadRequestException(
        'Connector does not support artifact registration',
      );
    }
    const issuerId = await registration
      .resolveIssuer(resolved.context, dto.issuer)
      .catch((error: unknown) => this.registrationError(error));
    const schema = dto.schema.id
      ? await registration
          .resolveSchema(resolved.context, dto.schema.id)
          .catch((error: unknown) => this.registrationError(error))
      : { definition: dto.schema.definition ?? {}, id: undefined };
    this.validateSchemaDefinition(dto.format, schema.definition);
    const options = {
      tag: dto.options?.tag ?? 'default',
      revocation: { enabled: dto.options?.revocation?.enabled ?? true },
    };
    const fingerprints = registrationFingerprints(
      {
        tenantId,
        connectorId: resolved.connector.id,
        issuerId,
        format: dto.format,
        schema,
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
          const operation = replay.registrationOperationId
            ? await manager.findOne(Operation, {
                where: { tenantId, id: replay.registrationOperationId },
              })
            : null;
          if (!replay.isActive || !operation) {
            throw new ConflictException({
              code: 'REGISTRATION_REPLAY_UNAVAILABLE',
              message:
                'Registration exists but is inactive or its operation has expired; reconcile it before retrying',
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
        const connectorType = Object.values(
          CredentialDefinitionConnectorType,
        ).find(
          (type) =>
            (type as string) === (resolved.connector.connectorType as string),
        );
        if (!connectorType) {
          throw new BadRequestException('Unknown registration connector type');
        }
        const created = await this.credentialDefinitionRepository.create(
          {
            tenantId,
            name: dto.name,
            format: dto.format,
            connectorId: resolved.connector.id,
            connectorType,
            schemaDefinition: schema.definition,
            externalId: null,
            metadata: dto.metadata,
            registrationState: 'pending',
            registrationOperationId: operation.id,
            requestFingerprint: fingerprints.request,
            artifactFingerprint: fingerprints.artifact,
            registration: {
              issuerId,
              schemaId: schema.id,
              options,
            },
          },
          manager,
        );
        operation.result = { credential_definition_id: created.id };
        await manager.save(Operation, operation);
        await this.jobs.sendInTransaction(
          manager,
          JOB_QUEUES.DEFINITION_REGISTER,
          {
            tenantId,
            definitionId: created.id,
          },
        );
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

  public async recover(
    tenantId: string,
    id: string,
    dto: RecoverCredentialDefinitionDto,
    auth: AuthContext,
  ): Promise<Operation> {
    await this.findById(tenantId, id, auth);
    return this.dataSource.transaction(async (manager) => {
      const binding = await manager.findOne(CredentialDefinition, {
        where: { id, tenantId, isActive: true },
        relations: { tenant: true },
      });
      if (
        !binding?.connectorId ||
        !binding.registration ||
        !binding.registrationOperationId
      ) {
        throw new ConflictException(
          'Definition has no recoverable registration',
        );
      }
      const locks: unknown = await manager.query(
        'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked',
        [`${tenantId}:${binding.connectorId}:registration`],
      );
      if (
        !Array.isArray(locks) ||
        !locks.some(
          (row: unknown) =>
            typeof row === 'object' &&
            row !== null &&
            'locked' in row &&
            row.locked === true,
        )
      ) {
        throw new ConflictException(
          'Registration is being processed; retry recovery later',
        );
      }
      const definition = await manager.findOne(CredentialDefinition, {
        where: { id, tenantId, isActive: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !definition?.registration ||
        !definition.registrationOperationId ||
        definition.connectorId !== binding.connectorId
      ) {
        throw new ConflictException(
          'Registration changed; reload before recovery',
        );
      }
      const operation = await manager.findOne(Operation, {
        where: { id: definition.registrationOperationId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !operation ||
        operation.type !== OPERATION_TYPE.CREDENTIAL_DEFINITION_REGISTER
      ) {
        throw new ConflictException(
          'Original registration operation is unavailable; recovery cannot discard its history',
        );
      }
      if (definition.registrationState === 'ready') {
        if (operation.state !== OperationState.COMPLETED) {
          throw new ConflictException(
            'Definition readiness and operation state disagree; manual reconciliation is required',
          );
        }
        return operation;
      }
      if (operation.state === OperationState.COMPLETED) {
        throw new ConflictException(
          'Completed operation has inconsistent registration state; manual reconciliation is required',
        );
      }
      if (!['pending', 'failed'].includes(definition.registrationState ?? '')) {
        throw new ConflictException(
          'Only pending or failed registrations can be recovered',
        );
      }
      const previous = definition.registration.recovery;
      const enriching = previous && definition.registrationState === 'pending';
      if (enriching) {
        if (
          (dto.schemaTransactionId &&
            previous.schemaTransactionId &&
            dto.schemaTransactionId !== previous.schemaTransactionId) ||
          (dto.definitionTransactionId &&
            previous.definitionTransactionId &&
            dto.definitionTransactionId !== previous.definitionTransactionId)
        ) {
          throw new ConflictException(
            'Recovery is already pending with different transaction hints',
          );
        }
        if (
          !(dto.schemaTransactionId && !previous.schemaTransactionId) &&
          !(dto.definitionTransactionId && !previous.definitionTransactionId)
        ) {
          return operation;
        }
      }
      const now = enriching ? new Date(previous.requestedAt) : new Date();
      const snapshot: Record<string, unknown> | null = operation.result
        ? structuredClone({ ...operation.result })
        : null;
      if (
        snapshot &&
        typeof snapshot.registration === 'object' &&
        snapshot.registration !== null
      ) {
        const progress: Record<string, unknown> = { ...snapshot.registration };
        delete progress.recovery_history;
        snapshot.registration = progress;
      }
      definition.registration.recovery = {
        requestedAt: now.toISOString(),
        schemaTransactionId:
          dto.schemaTransactionId ?? previous?.schemaTransactionId,
        definitionTransactionId:
          dto.definitionTransactionId ?? previous?.definitionTransactionId,
        history: enriching
          ? previous.history
          : [
              ...(previous?.history ?? []),
              {
                requestedAt: now.toISOString(),
                state: operation.state,
                result: snapshot,
              },
            ],
      };
      definition.registrationState = 'pending';
      operation.state = OperationState.PENDING;
      operation.viewedAt = null;
      const priorProgress = snapshot?.registration;
      operation.result = {
        credential_definition_id: id,
        external_id: definition.externalId,
        registration: {
          ...(typeof priorProgress === 'object' && priorProgress !== null
            ? priorProgress
            : {}),
          recovery_requested_at: now.toISOString(),
          recovery_attempts: definition.registration.recovery.history.length,
          recovery_history: definition.registration.recovery.history,
        },
        problem_details: operation.result?.problem_details ?? null,
      };
      operation.expiresAt = this.operations.computeExpiresAt(
        OperationState.PENDING,
        now,
        null,
        binding.tenant.config,
      );
      await manager.save(CredentialDefinition, definition);
      await manager.save(Operation, operation);
      await this.jobs.sendInTransaction(
        manager,
        JOB_QUEUES.DEFINITION_REGISTER,
        {
          tenantId,
          definitionId: id,
        },
      );
      await this.domainAudit.emit(
        {
          tenantId,
          action: AuditAction.UPDATE,
          resourceType: 'credential_definition',
          resourceId: id,
          metadata: {
            action: 'registration_recovery_requested',
            operation_id: operation.id,
          },
        },
        manager,
      );
      return operation;
    });
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
    if (dto.metadata !== undefined) changes.metadata = dto.metadata;
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
