import {
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  IsDefined,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
  ValidateIf,
} from 'class-validator';

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

  @ApiProperty({ type: RegistrationSchemaDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => RegistrationSchemaDto)
  public schema!: RegistrationSchemaDto;

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
