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
import { assertClaimsSchemaUsable } from '../issuance-profile/claims-schema';
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
    if (!isRecord(properties) && isRecord(schemaDefinition.attributes)) {
      properties = this.normalizeDefinition(schemaDefinition).properties;
    } else if (
      !isRecord(properties) &&
      Array.isArray(schemaDefinition.attr_names)
    ) {
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
    const inlineDefinition = dto.schema.definition
      ? this.normalizeDefinition(dto.schema.definition)
      : undefined;
    if (inlineDefinition) this.validateSchemaDefinition(inlineDefinition);

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
    const imported = dto.schema.id
      ? await registration.resolveSchema(resolved.context, dto.schema.id)
      : undefined;
    const schemaDefinition = imported
      ? this.normalizeDefinition(imported.definition)
      : (inlineDefinition ?? {});
    if (imported) this.validateSchemaDefinition(schemaDefinition);
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
      schemaDefinition,
      registration: {
        issuerId,
        schema: imported?.id ? { id: imported.id, state: 'finished' } : {},
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
    if (this.formatValidators.has(CredentialFormat.AnonCreds)) {
      const issues = this.formatValidators
        .resolve(CredentialFormat.AnonCreds)
        .validateSchema(schemaDefinition);
      if (issues.length > 0) {
        throw new BadRequestException({
          code: 'BAD_REQUEST',
          message: 'Credential definition schema failed format validation',
          details: issues,
        });
      }
    }

    // Issuance profiles compile this schema with strict Ajv; reject anything
    // they cannot use before the definition is registered.
    assertClaimsSchemaUsable(
      this.getClaimsSchema(schemaDefinition),
      this.getMandatoryClaims(schemaDefinition),
    );
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
      throw new BadRequestException(
        'AnonCreds schema requires schema_name, schema_version, and an attributes map',
      );
    }

    let properties: Record<string, unknown>;
    if (isRecord(schemaProperties)) {
      properties = { ...schemaProperties };
    } else if (isRecord(attributes)) {
      properties = Object.fromEntries(
        Object.entries(attributes).map(([name, type]) => {
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
          return [name, { type }];
        }),
      );
    } else {
      properties = Object.fromEntries(
        (Array.isArray(legacyNames) ? legacyNames : [])
          .filter((name): name is string => typeof name === 'string')
          .map((name) => [name, { type: 'string' }]),
      );
    }

    return {
      schema_name: schemaName,
      schema_version: schemaVersion,
      type: 'object',
      properties,
    };
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

  public prepare(
    _tenantId: string,
    _dto: CreateCredentialDefinitionDto,
  ): Promise<PreparedCredentialDefinition> {
    return Promise.reject(new FormatNotSupportedError(this.format));
  }

  public register(
    _definition: CredentialDefinition,
    _manager: EntityManager,
  ): Promise<void> {
    return Promise.reject(new FormatNotSupportedError(this.format));
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
