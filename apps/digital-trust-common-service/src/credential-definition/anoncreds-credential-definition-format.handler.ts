import {
  CredentialFormat,
  FormatNotSupportedError,
  FormatValidatorRegistry,
} from '@app/credential-ports';
import { JOB_QUEUES } from '@app/pg-boss';
import { BadRequestException, Injectable } from '@nestjs/common';
import { instanceToPlain, plainToInstance } from 'class-transformer';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

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

  return instanceToPlain(instance);
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
      return {
        definition: this.normalizeDefinition(schema.definition),
      };
    }
    return schema;
  }

  public getClaimsSchema(
    schemaDefinition: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> {
    let properties = schemaDefinition.properties;
    if (!isRecord(properties) && Array.isArray(schemaDefinition.attr_names)) {
      properties = Object.fromEntries(
        schemaDefinition.attr_names
          .filter((name): name is string => typeof name === 'string')
          .map((name) => [name, { type: 'string' }]),
      );
    }
    return {
      type: 'object',
      properties,
    };
  }

  public getMandatoryClaims(
    schemaDefinition: Readonly<Record<string, unknown>>,
  ): readonly string[] {
    const required = schemaDefinition.required;
    return Array.isArray(required)
      ? required.filter((name): name is string => typeof name === 'string')
      : [];
  }

  public prepareClaimsForValidation(
    schemaDefinition: Readonly<Record<string, unknown>>,
    claims: Readonly<Record<string, unknown>>,
  ): { claims: Record<string, unknown>; omittedClaims: string[] } {
    const properties = this.getClaimsSchema(schemaDefinition).properties;
    if (!isRecord(properties)) {
      return { claims: { ...claims }, omittedClaims: [] };
    }

    const omittedClaims = Object.keys(properties).filter(
      (name) => !Object.hasOwn(claims, name),
    );

    return {
      claims: {
        ...Object.fromEntries(omittedClaims.map((name) => [name, ''])),
        ...claims,
      },
      omittedClaims,
    };
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
    const registration = resolved.adapter.anonCredsRegistration;
    if (!registration) {
      throw new FormatNotSupportedError(CredentialDefinitionFormat.ANONCREDS, {
        connectorType: resolved.connector.connectorType,
      });
    }

    const issuerId = await registration.resolveIssuer(
      resolved.context,
      dto.issuer,
    );
    const resolvedSchema = dto.schema.id
      ? await registration.resolveSchema(resolved.context, dto.schema.id)
      : { definition: dto.schema.definition ?? {}, id: undefined };
    const schema = {
      ...resolvedSchema,
      definition: this.normalizeDefinition(resolvedSchema.definition),
    };
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

  private normalizeDefinition(
    definition: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> {
    const schemaName = definition.schema_name;
    const schemaVersion = definition.schema_version;
    const attributes = definition.attributes;
    const schemaProperties = definition.properties;
    const legacyNames = definition.attr_names;
    if (
      typeof schemaName !== 'string' ||
      typeof schemaVersion !== 'string' ||
      (!isRecord(attributes) &&
        !isRecord(schemaProperties) &&
        !Array.isArray(legacyNames))
    ) {
      this.validateSchemaDefinition(definition);
    }

    const properties: Record<string, unknown> = {};
    if (isRecord(schemaProperties)) {
      Object.assign(properties, schemaProperties);
    } else if (isRecord(attributes)) {
      for (const [name, type] of Object.entries(attributes)) {
        if (
          type !== 'string' &&
          type !== 'integer' &&
          type !== 'number' &&
          type !== 'boolean'
        ) {
          throw new BadRequestException(
            `AnonCreds attribute '${name}' must have a string, integer, number, or boolean type`,
          );
        }
        properties[name] = { type };
      }
    } else if (Array.isArray(legacyNames)) {
      for (const name of legacyNames) {
        if (typeof name === 'string') properties[name] = { type: 'string' };
      }
    }

    const normalized = {
      schema_name: schemaName,
      schema_version: schemaVersion,
      type: 'object',
      properties,
    };
    this.validateSchemaDefinition(normalized);
    return normalized;
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

  public getClaimsSchema(
    schemaDefinition: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> {
    return schemaDefinition;
  }

  public getMandatoryClaims(
    schemaDefinition: Readonly<Record<string, unknown>>,
  ): readonly string[] {
    const required = schemaDefinition.required;
    return Array.isArray(required)
      ? required.filter((name): name is string => typeof name === 'string')
      : [];
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
