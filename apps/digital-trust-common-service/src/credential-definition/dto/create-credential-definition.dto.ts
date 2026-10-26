import {
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  IsEnum,
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

import { CredentialDefinitionFormat } from '../credential-definition.entity';

import {
  AnonCredsCredentialDefinitionOptionsDto,
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

  @ApiProperty({ enum: CredentialDefinitionFormat })
  @IsEnum(CredentialDefinitionFormat)
  public format!: CredentialDefinitionFormat;

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

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Client annotations for this credential definition.',
  })
  @IsOptional()
  @IsObject()
  public metadata?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Immutable, format-specific publication options.',
    oneOf: [
      { $ref: getSchemaPath(AnonCredsCredentialDefinitionOptionsDto) },
      { $ref: getSchemaPath(SdJwtCredentialDefinitionOptionsDto) },
      { $ref: getSchemaPath(MdlCredentialDefinitionOptionsDto) },
      { $ref: getSchemaPath(W3cVcCredentialDefinitionOptionsDto) },
    ],
  })
  @IsOptional()
  @IsObject()
  public options?: Record<string, unknown>;
}
