import { Expose } from 'class-transformer';
import {
  IsString,
  IsEnum,
  IsObject,
  IsOptional,
  MaxLength,
} from 'class-validator';

import {
  CredentialDefinitionFormat,
  CredentialDefinitionConnectorType,
} from '../credential-definition.entity';

export class CreateCredentialDefinitionDto {
  @Expose()
  @IsString()
  @MaxLength(255)
  public name!: string;

  @Expose()
  @IsEnum(CredentialDefinitionFormat)
  public format!: CredentialDefinitionFormat;

  @Expose({ name: 'schema_definition' })
  @IsObject()
  public schemaDefinition!: Record<string, unknown>;

  @Expose({ name: 'external_id' })
  @IsString()
  @MaxLength(255)
  public externalId!: string;

  @Expose({ name: 'connector_type' })
  @IsEnum(CredentialDefinitionConnectorType)
  public connectorType!: CredentialDefinitionConnectorType;

  @Expose()
  @IsOptional()
  @IsObject()
  public metadata?: Record<string, unknown>;
}
