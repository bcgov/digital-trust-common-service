import {
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
  ValidateIf,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

import { CredentialDefinitionStatus } from '../credential-definition.entity';

import {
  AnonCredsCredentialDefinitionOptionsDto,
  CredentialDefinitionOptionsBase,
  MdlCredentialDefinitionOptionsDto,
  SdJwtCredentialDefinitionOptionsDto,
  W3cVcCredentialDefinitionOptionsDto,
} from './credential-definition-options.dto';

export class RegistrationSchemaDto {
  @ApiPropertyOptional({
    description: 'Published schema ID; excludes definition',
  })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  public id?: string;

  @ApiPropertyOptional({ description: 'New schema content; excludes id' })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsObject()
  public definition?: Record<string, unknown>;
}

export type RegistrationSchema =
  | { id: string; definition?: never }
  | { definition: Record<string, unknown>; id?: never };

@ValidatorConstraint({ name: 'schemaSourceExclusive', async: false })
class SchemaSourceExclusiveConstraint implements ValidatorConstraintInterface {
  public validate(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const schema = value as RegistrationSchemaDto;
    return (schema.id !== undefined) !== (schema.definition !== undefined);
  }

  public defaultMessage(): string {
    return 'Supply schema.id or schema.definition, not both';
  }
}

export class RegistrationIssuerDto {
  @ApiPropertyOptional({ description: 'Existing issuer ID; excludes method' })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  public id?: string;

  @ApiPropertyOptional({ description: 'Existing DID method; excludes id' })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  public method?: string;
}

export class CreateCredentialDefinitionDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  public name!: string;

  @Expose({ name: 'connector_id' })
  @ApiPropertyOptional({ name: 'connector_id', format: 'uuid' })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsUUID()
  public connectorId?: string;

  @Expose()
  @ApiPropertyOptional({ enum: CredentialDefinitionStatus })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsEnum(CredentialDefinitionStatus)
  public status?: CredentialDefinitionStatus;

  @ApiProperty({
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 2048 },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['definition'],
        properties: {
          definition: {
            type: 'object',
            additionalProperties: true,
            description:
              'Free-form schema definition interpreted according to options.format.',
          },
        },
      },
    ],
    description:
      'Supply exactly one of id or definition. AnonCreds definitions require schema_name, schema_version, and attr_names.',
  })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Validate(SchemaSourceExclusiveConstraint)
  @Type(() => RegistrationSchemaDto)
  public schema!: RegistrationSchema;

  @ApiPropertyOptional({ type: RegistrationIssuerDto })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => RegistrationIssuerDto)
  public issuer?: RegistrationIssuerDto;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Client annotations for this credential definition.',
  })
  @IsOptional()
  @IsObject()
  public metadata?: Record<string, unknown>;

  @ApiProperty({
    description: 'Immutable, format-specific publication options.',
    oneOf: [
      { $ref: getSchemaPath(AnonCredsCredentialDefinitionOptionsDto) },
      { $ref: getSchemaPath(SdJwtCredentialDefinitionOptionsDto) },
      { $ref: getSchemaPath(MdlCredentialDefinitionOptionsDto) },
      { $ref: getSchemaPath(W3cVcCredentialDefinitionOptionsDto) },
    ],
    discriminator: {
      propertyName: 'format',
      mapping: {
        anoncreds: getSchemaPath(AnonCredsCredentialDefinitionOptionsDto),
        'sd-jwt': getSchemaPath(SdJwtCredentialDefinitionOptionsDto),
        mdl: getSchemaPath(MdlCredentialDefinitionOptionsDto),
        'w3c-vc': getSchemaPath(W3cVcCredentialDefinitionOptionsDto),
      },
    },
  })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => CredentialDefinitionOptionsBase, {
    discriminator: {
      property: 'format',
      subTypes: [
        {
          name: 'anoncreds',
          value: AnonCredsCredentialDefinitionOptionsDto,
        },
        { name: 'sd-jwt', value: SdJwtCredentialDefinitionOptionsDto },
        { name: 'mdl', value: MdlCredentialDefinitionOptionsDto },
        { name: 'w3c-vc', value: W3cVcCredentialDefinitionOptionsDto },
      ],
    },
    keepDiscriminatorProperty: true,
  })
  public options!:
    | AnonCredsCredentialDefinitionOptionsDto
    | SdJwtCredentialDefinitionOptionsDto
    | MdlCredentialDefinitionOptionsDto
    | W3cVcCredentialDefinitionOptionsDto;
}
