import {
  IsUUID,
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
  @IsUUID()
  public tenantId!: string;

  @IsString()
  @MaxLength(255)
  public name!: string;

  @IsEnum(CredentialDefinitionFormat)
  public format!: CredentialDefinitionFormat;

  @IsObject()
  public schemaDefinition!: Record<string, unknown>;

  @IsString()
  @MaxLength(255)
  public externalId!: string;

  @IsEnum(CredentialDefinitionConnectorType)
  public connectorType!: CredentialDefinitionConnectorType;

  @IsOptional()
  @IsObject()
  public metadata?: Record<string, unknown>;
}
