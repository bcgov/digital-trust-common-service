import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

import {
  CredentialDefinition,
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
} from '../credential-definition.entity';

export class CredentialDefinitionResponseDto {
  @ApiProperty({
    description: 'The unique identifier of the credential definition',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public id!: string;

  @Expose({ name: 'tenant_id' })
  @ApiProperty({
    name: 'tenant_id',
    description: 'The tenant ID this credential definition belongs to',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public tenantId!: string;

  @ApiProperty({
    description: 'The name of the credential definition',
    example: 'University Diploma',
  })
  public name!: string;

  @ApiProperty({
    description: 'The format of the credential definition',
    enum: CredentialDefinitionFormat,
    example: CredentialDefinitionFormat.ANONCREDS,
  })
  public format!: CredentialDefinitionFormat;

  @Expose({ name: 'schema_definition' })
  @ApiProperty({
    name: 'schema_definition',
    description: 'The schema definition for the credential',
    example: {
      attributes: ['name', 'date', 'signature'],
      version: '1.0',
    },
  })
  public schemaDefinition!: Record<string, unknown>;

  @Expose({ name: 'external_id' })
  @ApiProperty({
    name: 'external_id',
    description: 'The external ID from the connector system',
    example: 'cred-def-123456',
  })
  public externalId!: string;

  @Expose({ name: 'connector_type' })
  @ApiProperty({
    name: 'connector_type',
    description: 'The type of connector used for this credential definition',
    enum: CredentialDefinitionConnectorType,
    example: CredentialDefinitionConnectorType.TRACTION,
  })
  public connectorType!: CredentialDefinitionConnectorType;

  @ApiProperty({
    description: 'Additional metadata for the credential definition',
    example: {
      issuer: 'Example University',
      version: '2.0',
    },
    required: false,
  })
  public metadata?: Record<string, unknown>;

  @Expose({ name: 'created_at' })
  @ApiProperty({
    name: 'created_at',
    description: 'The date and time when the credential definition was created',
    example: '2024-01-01T00:00:00Z',
  })
  public createdAt!: Date;

  @Expose({ name: 'updated_at' })
  @ApiProperty({
    name: 'updated_at',
    description:
      'The date and time when the credential definition was last updated',
    example: '2024-01-01T00:00:00Z',
  })
  public updatedAt!: Date;

  public static fromEntity(
    credentialDefinition: CredentialDefinition,
  ): CredentialDefinitionResponseDto {
    const dto = new CredentialDefinitionResponseDto();
    dto.id = credentialDefinition.id;
    dto.tenantId = credentialDefinition.tenantId;
    dto.name = credentialDefinition.name;
    dto.format = credentialDefinition.format;
    dto.schemaDefinition = credentialDefinition.schemaDefinition;
    dto.externalId = credentialDefinition.externalId;
    dto.connectorType = credentialDefinition.connectorType;
    dto.metadata = credentialDefinition.metadata;
    dto.createdAt = credentialDefinition.createdAt;
    dto.updatedAt = credentialDefinition.updatedAt;
    return dto;
  }
}
