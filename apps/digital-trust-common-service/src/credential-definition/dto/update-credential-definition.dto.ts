import { ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  IsUUID,
} from 'class-validator';

import { CredentialDefinitionStatus } from '../credential-definition.entity';

export class UpdateCredentialDefinitionDto {
  @Expose()
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  public name?: string;

  @Expose({ name: 'schema_definition' })
  @ApiPropertyOptional({
    name: 'schema_definition',
    description: 'Updated format-specific schema; draft definitions only.',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  public schemaDefinition?: Record<string, unknown>;

  @Expose({ name: 'connector_id' })
  @ApiPropertyOptional({
    name: 'connector_id',
    format: 'uuid',
    description: 'Updated connector credential; draft definitions only.',
  })
  @IsOptional()
  @IsUUID()
  public connectorId?: string;

  @Expose()
  @ApiPropertyOptional({ enum: CredentialDefinitionStatus })
  @IsOptional()
  @IsEnum(CredentialDefinitionStatus)
  public status?: CredentialDefinitionStatus;

  @Expose()
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  public metadata?: Record<string, unknown>;
}
