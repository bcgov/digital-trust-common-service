import {
  CredentialFormat,
  FormatNotSupportedError,
  FormatValidatorRegistry,
} from '@app/credential-ports';
import { JOB_QUEUES } from '@app/pg-boss';
import { BadRequestException, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { EntityManager } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { JobsService } from '../jobs/jobs.service';

import type {
  CredentialDefinitionFormatHandler,
  PreparedCredentialDefinition,
} from './credential-definition-format-handler';
import {
  CredentialDefinition,
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
} from './credential-definition.entity';
import type {
  CreateCredentialDefinitionDto,
  RegistrationSchema,
} from './dto/create-credential-definition.dto';
import {
  AnonCredsCredentialDefinitionOptionsDto,
  MdlCredentialDefinitionOptionsDto,
  SdJwtCredentialDefinitionOptionsDto,
  W3cVcCredentialDefinitionOptionsDto,
} from './dto/credential-definition-options.dto';

type OptionsDtoClass = new () => object;

function normalizeOptions<T extends object>(
  dtoClass: new () => T,
  options: unknown,
): Record<string, unknown> {
  if (
    options !== undefined &&
    options !== null &&
    (typeof options !== 'object' || Array.isArray(options))
  ) {
    throw new BadRequestException(
      'Credential definition options must be an object',
    );
  }

  const instance = plainToInstance(dtoClass, options ?? {});
  const errors = validateSync(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
    validationError: { target: false, value: false },
  });
  if (errors.length > 0) {
    throw new BadRequestException({
      message: 'Credential definition options are invalid',
      issues: errors,
    });
  }

  return instance as T & Record<string, unknown>;
}

@Injectable()
export class AnonCredsCredentialDefinitionFormatHandler implements CredentialDefinitionFormatHandler {
  public readonly format = CredentialDefinitionFormat.ANONCREDS;

  public constructor(
    private readonly adapters: AdapterRegistry,
    private readonly jobs: JobsService,
    private readonly formatValidators: FormatValidatorRegistry,
  ) {}

  public normalizeOptions(options: unknown): Record<string, unknown> {
    return normalizeOptions(AnonCredsCredentialDefinitionOptionsDto, options);
  }

  public normalizeSchema(schema: RegistrationSchema): RegistrationSchema {
    this.validateSchemaSource(schema);
    if (schema.definition !== undefined) {
      this.validateSchemaDefinition(schema.definition);
    }
    return schema;
  }

  public async prepare(
    tenantId: string,
    dto: CreateCredentialDefinitionDto,
  ): Promise<PreparedCredentialDefinition> {
    this.validateSchemaSource(dto.schema);
    this.validateIssuerSelection(dto);

    const resolved = await this.adapters.resolve(
      tenantId,
      CredentialFormat.AnonCreds,
      { connectorId: dto.connectorId },
    );
    const registration = resolved.adapter.definitionRegistration;
    if (!registration) {
      throw new FormatNotSupportedError(CredentialDefinitionFormat.ANONCREDS, {
        connectorType: resolved.connector.connectorType,
      });
    }

    const issuerId = await registration.resolveIssuer(
      resolved.context,
      dto.issuer,
    );
    const schema = dto.schema.id
      ? await registration.resolveSchema(resolved.context, dto.schema.id)
      : { definition: dto.schema.definition ?? {}, id: undefined };
    if (dto.schema.id) {
      this.validateSchemaDefinition(schema.definition);
    }
    const connectorTypeValue: string = resolved.connector.connectorType;
    const connectorType = Object.values(CredentialDefinitionConnectorType).find(
      (type) => String(type) === connectorTypeValue,
    );
    if (!connectorType) {
      throw new BadRequestException('Unknown registration connector type');
    }

    return {
      connectorId: resolved.connector.id,
      connectorType,
      schemaDefinition: schema.definition,
      registration: {
        issuerId,
        schema: schema.id ? { id: schema.id, state: 'finished' } : {},
        definition: {},
      },
    };
  }

  public async register(
    definition: CredentialDefinition,
    manager: EntityManager,
  ): Promise<void> {
    await this.jobs.sendInTransaction(
      manager,
      JOB_QUEUES.DEFINITION_REGISTER,
      {
        tenantId: definition.tenantId,
        definitionId: definition.id,
      },
      { singletonKey: definition.id },
    );
  }

  private validateSchemaSource(schema: RegistrationSchema): void {
    if (
      !schema ||
      (schema.id !== undefined) === (schema.definition !== undefined)
    ) {
      throw new BadRequestException(
        'Supply schema.id or schema.definition, not both',
      );
    }
  }

  private validateSchemaDefinition(
    schemaDefinition: Readonly<Record<string, unknown>>,
  ): void {
    if (!this.formatValidators.has(CredentialFormat.AnonCreds)) {
      return;
    }

    const issues = this.formatValidators
      .resolve(CredentialFormat.AnonCreds)
      .validateSchema(schemaDefinition);
    if (issues.length > 0) {
      throw new BadRequestException({
        message: 'Credential definition schema failed format validation',
        issues,
      });
    }
  }

  private validateIssuerSelection(dto: CreateCredentialDefinitionDto): void {
    if (
      dto.issuer &&
      (dto.issuer.id !== undefined) === (dto.issuer.method !== undefined)
    ) {
      throw new BadRequestException(
        'Supply issuer.id or issuer.method, not both',
      );
    }
  }
}

export class NoRegistrationCredentialDefinitionFormatHandler implements CredentialDefinitionFormatHandler {
  public constructor(
    public readonly format: CredentialDefinitionFormat,
    private readonly optionsDto: OptionsDtoClass,
    private readonly adapters: AdapterRegistry,
  ) {}

  public normalizeOptions(options: unknown): Record<string, unknown> {
    return normalizeOptions(this.optionsDto, options);
  }

  public normalizeSchema(schema: RegistrationSchema): RegistrationSchema {
    if (
      !schema ||
      (schema.id !== undefined) === (schema.definition !== undefined)
    ) {
      throw new BadRequestException(
        'Supply schema.id or schema.definition, not both',
      );
    }
    return schema;
  }

  public async prepare(
    tenantId: string,
    dto: CreateCredentialDefinitionDto,
  ): Promise<PreparedCredentialDefinition> {
    if (
      !dto.schema ||
      (dto.schema.id !== undefined) === (dto.schema.definition !== undefined)
    ) {
      throw new BadRequestException(
        'Supply schema.id or schema.definition, not both',
      );
    }

    const resolved = await this.adapters.resolve(tenantId, undefined, {
      connectorId: dto.connectorId,
    });
    const connectorTypeValue: string = resolved.connector.connectorType;
    const connectorType = Object.values(CredentialDefinitionConnectorType).find(
      (type) => String(type) === connectorTypeValue,
    );
    if (!connectorType) {
      throw new BadRequestException('Unknown registration connector type');
    }
    return {
      connectorId: resolved.connector.id,
      connectorType,
      schemaDefinition: dto.schema.definition ?? { id: dto.schema.id },
      registration: null,
    };
  }

  public async register(
    definition: CredentialDefinition,
    manager: EntityManager,
  ): Promise<void> {
    definition.registrationState = 'ready';
    await manager.update(
      CredentialDefinition,
      { id: definition.id, tenantId: definition.tenantId },
      { registrationState: 'ready' },
    );
  }
}

export const NO_REGISTRATION_FORMATS = [
  {
    format: CredentialDefinitionFormat.SD_JWT,
    optionsDto: SdJwtCredentialDefinitionOptionsDto,
  },
  {
    format: CredentialDefinitionFormat.MDL,
    optionsDto: MdlCredentialDefinitionOptionsDto,
  },
  {
    format: CredentialDefinitionFormat.W3C_VC,
    optionsDto: W3cVcCredentialDefinitionOptionsDto,
  },
] as const;
