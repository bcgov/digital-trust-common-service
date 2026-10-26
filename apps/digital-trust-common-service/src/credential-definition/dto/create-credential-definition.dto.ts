import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  Equals,
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

export class RegistrationSchemaDto {
  @ApiPropertyOptional({ enum: ['anoncreds'], default: 'anoncreds' })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Equals('anoncreds')
  public type?: 'anoncreds';

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

  @ApiProperty({ enum: ['anoncreds'] })
  @Equals(CredentialDefinitionFormat.ANONCREDS)
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
    description:
      'Local metadata. Reserved keys: tag (1–100 characters, default "default") and revocation { enabled: boolean } (default true). Other keys are annotations.',
    example: {
      tag: 'default',
      revocation: { enabled: true },
      issuer: 'DMV',
    },
  })
  @IsOptional()
  @IsObject()
  public metadata?: Record<string, unknown>;
}
