import { isDeepStrictEqual } from 'node:util';

import type { AuthContext } from '@app/auth';
import {
  AdapterError,
  CredentialFormat,
  FormatNotSupportedError,
} from '@app/credential-ports';
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

/**
 * Maps entity formats onto port-layer formats when their values match. The
 * entity enum accepts more formats than the port layer currently supports.
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
    const format = dto.options.format;
    const handler = this.formatHandlers.find(
      (candidate) => candidate.format === format,
    );
    if (!handler) {
      this.registrationError(new FormatNotSupportedError(format));
    }
    const options = handler.normalizeOptions(dto.options);
    const schema = handler.normalizeSchema(dto.schema);
    const prepared = await handler
      .prepare(tenantId, { ...dto, schema })
      .catch((error: unknown) => this.registrationError(error));
    let result: {
      definition: CredentialDefinition;
      operation: Operation;
      created: boolean;
    };
    try {
      result = await this.dataSource.transaction((manager) =>
        this.createOrContinue(
          manager,
          handler,
          tenantId,
          dto,
          prepared,
          options,
        ),
      );
    } catch (error) {
      if (!this.isUniqueViolation(error)) {
        throw error;
      }
      result = await this.dataSource.transaction(async (manager) => {
        const existing =
          await this.credentialDefinitionRepository.findExistingByTenantAndNameAndFormat(
            tenantId,
            dto.name,
            format,
            manager,
          );
        if (!existing) {
          throw new ConflictException(
            'Credential definition already exists for this tenant.',
          );
        }
        return await this.continueExisting(
          manager,
          handler,
          existing,
          tenantId,
          dto,
          prepared,
          options,
        );
      });
    }

    if (result.created) {
      await this.domainAudit.emit({
        tenantId: result.definition.tenantId,
        action: AuditAction.CREATE,
        resourceType: 'credential_definition',
        resourceId: result.definition.id,
      });
    }

    return result.operation;
  }

  private async createOrContinue(
    manager: import('typeorm').EntityManager,
    handler: CredentialDefinitionFormatHandler,
    tenantId: string,
    dto: CreateCredentialDefinitionDto,
    prepared: Awaited<ReturnType<CredentialDefinitionFormatHandler['prepare']>>,
    options: Record<string, unknown>,
  ): Promise<{
    definition: CredentialDefinition;
    operation: Operation;
    created: boolean;
  }> {
    const existing =
      await this.credentialDefinitionRepository.findExistingByTenantAndNameAndFormat(
        tenantId,
        dto.name,
        dto.options.format,
        manager,
      );
    if (existing) {
      return await this.continueExisting(
        manager,
        handler,
        existing,
        tenantId,
        dto,
        prepared,
        options,
      );
    }

    const operation = await this.createRegistrationOperation(
      tenantId,
      dto,
      manager,
    );
    const definition = await this.credentialDefinitionRepository.create(
      {
        tenantId,
        name: dto.name,
        format: dto.options.format,
        connectorId: prepared.connectorId,
        connectorType: prepared.connectorType,
        schemaDefinition: prepared.schemaDefinition,
        externalId: null,
        metadata: dto.metadata,
        options,
        registrationState: 'pending',
        registrationOperationId: operation.id,
        registration: prepared.registration,
      },
      manager,
    );
    operation.result = { credential_definition_id: definition.id };
    await manager.save(Operation, operation);
    await handler.register(definition, manager);
    await this.completeImmediateRegistration(
      definition,
      operation,
      tenantId,
      manager,
    );
    return { definition, operation, created: true };
  }

  private async continueExisting(
    manager: import('typeorm').EntityManager,
    handler: CredentialDefinitionFormatHandler,
    definition: CredentialDefinition,
    tenantId: string,
    dto: CreateCredentialDefinitionDto,
    prepared: Awaited<ReturnType<CredentialDefinitionFormatHandler['prepare']>>,
    options: Record<string, unknown>,
  ): Promise<{
    definition: CredentialDefinition;
    operation: Operation;
    created: boolean;
  }> {
    if (
      definition.connectorId !== prepared.connectorId ||
      definition.connectorType !== prepared.connectorType ||
      !isDeepStrictEqual(
        definition.schemaDefinition,
        prepared.schemaDefinition,
      ) ||
      (dto.schema.id !== undefined &&
        definition.registration?.schema.id !==
          prepared.registration?.schema.id) ||
      !isDeepStrictEqual(definition.options ?? {}, options) ||
      definition.registration?.issuerId !== prepared.registration?.issuerId
    ) {
      throw new ConflictException(
        'Credential definition registration settings differ from the existing definition.',
      );
    }
    if (!definition.isActive && definition.registrationState === 'ready') {
      throw new ConflictException({
        code: 'REGISTRATION_REPLAY_UNAVAILABLE',
        message:
          'A deactivated credential definition with this name and format already exists and will not be reactivated.',
        credential_definition_id: definition.id,
      });
    }
    if (!definition.isActive && definition.registrationState !== 'failed') {
      throw new ConflictException({
        code: 'REGISTRATION_REPLAY_UNAVAILABLE',
        message: 'The inactive credential definition cannot be continued.',
        credential_definition_id: definition.id,
      });
    }

    if (definition.registrationState === 'failed') {
      const operation = await this.createRegistrationOperation(
        tenantId,
        dto,
        manager,
      );
      definition.isActive = true;
      definition.registrationState = 'pending';
      definition.registrationOperationId = operation.id;
      await manager.update(
        CredentialDefinition,
        { id: definition.id, tenantId },
        {
          isActive: true,
          registrationState: 'pending',
          registrationOperationId: operation.id,
        },
      );
      operation.result = { credential_definition_id: definition.id };
      await manager.save(Operation, operation);
      await handler.register(definition, manager);
      await this.completeImmediateRegistration(
        definition,
        operation,
        tenantId,
        manager,
      );
      return { definition, operation, created: false };
    }

    if (definition.registrationState === 'pending') {
      const operation = definition.registrationOperationId
        ? await manager.findOne(Operation, {
            where: { id: definition.registrationOperationId, tenantId },
          })
        : null;
      if (
        !definition.isActive ||
        !operation ||
        operation.state === OperationState.FAILED
      ) {
        throw new ConflictException({
          code: 'REGISTRATION_REPLAY_UNAVAILABLE',
          message: 'The pending registration operation is unavailable.',
          credential_definition_id: definition.id,
        });
      }
      await handler.register(definition, manager);
      return { definition, operation, created: false };
    }

    if (definition.registrationState === 'ready') {
      const operation = definition.registrationOperationId
        ? await manager.findOne(Operation, {
            where: { id: definition.registrationOperationId, tenantId },
          })
        : null;
      if (
        !definition.isActive ||
        operation?.state !== OperationState.COMPLETED
      ) {
        throw new ConflictException({
          code: 'REGISTRATION_REPLAY_UNAVAILABLE',
          message: 'The completed registration operation is unavailable.',
          credential_definition_id: definition.id,
        });
      }
      return { definition, operation, created: false };
    }

    throw new ConflictException(
      'Credential definition registration cannot be continued.',
    );
  }

  private async createRegistrationOperation(
    tenantId: string,
    dto: CreateCredentialDefinitionDto,
    manager: import('typeorm').EntityManager,
  ): Promise<Operation> {
    return await this.operations.createOperation(
      {
        tenantId,
        type: OPERATION_TYPE.CREDENTIAL_DEFINITION_REGISTER,
        request: {
          method: 'POST',
          path: `${API_BASE_PATH}/tenants/${tenantId}/credential-definitions`,
          body: { name: dto.name, options: { format: dto.options.format } },
        },
      },
      manager,
    );
  }

  private async completeImmediateRegistration(
    definition: CredentialDefinition,
    operation: Operation,
    tenantId: string,
    manager: import('typeorm').EntityManager,
  ): Promise<void> {
    if (definition.registrationState !== 'ready') {
      return;
    }
    const completed = await this.operations.transitionState(
      operation.id,
      OperationState.COMPLETED,
      operation.result,
      manager,
      tenantId,
    );
    Object.assign(operation, completed);
  }

  private isUniqueViolation(error: unknown): boolean {
    const driver: unknown =
      error instanceof QueryFailedError ? error.driverError : null;
    return (
      typeof driver === 'object' &&
      driver !== null &&
      'code' in driver &&
      driver.code === '23505'
    );
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
