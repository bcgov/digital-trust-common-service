import {
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import { Expose } from 'class-transformer';

import {
  CredentialDefinition,
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
} from '../credential-definition.entity';

import {
  AnonCredsCredentialDefinitionOptionsDto,
  MdlCredentialDefinitionOptionsDto,
  SdJwtCredentialDefinitionOptionsDto,
  W3cVcCredentialDefinitionOptionsDto,
} from './credential-definition-options.dto';

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
    type: String,
    nullable: true,
    description: 'The external ID from the connector system',
    example: 'cred-def-123456',
  })
  public externalId!: string | null;

  @Expose({ name: 'connector_id' })
  @ApiProperty({ name: 'connector_id', nullable: true, format: 'uuid' })
  public connectorId!: string | null;

  @Expose({ name: 'registration_state' })
  @ApiProperty({
    name: 'registration_state',
    enum: ['unverified', 'pending', 'ready', 'failed'],
  })
  public registrationState!: string;

  @Expose({ name: 'registration_operation_id' })
  @ApiProperty({ name: 'registration_operation_id', nullable: true })
  public registrationOperationId!: string | null;

  @ApiProperty({ nullable: true, description: 'Resolved issuer identity' })
  public issuer!: { id: string } | null;

  @ApiProperty({ nullable: true, description: 'Resolved schema reference' })
  public schema!: { id: string | null } | null;

  @Expose({ name: 'connector_type' })
  @ApiProperty({
    name: 'connector_type',
    description: 'The type of connector used for this credential definition',
    enum: CredentialDefinitionConnectorType,
    example: CredentialDefinitionConnectorType.TRACTION,
  })
  public connectorType!: CredentialDefinitionConnectorType;

  @Expose({ name: 'is_active' })
  @ApiProperty({
    name: 'is_active',
    description: 'Whether this credential definition is currently active',
    example: true,
  })
  public isActive!: boolean;

  @ApiPropertyOptional({
    description: 'Free-form client annotations',
    nullable: true,
    example: {
      issuer: 'Example University',
      version: '2.0',
    },
  })
  public metadata?: Record<string, unknown>;

  @ApiProperty({
    description:
      'Immutable, normalized publication options. options.format matches the root format.',
    readOnly: true,
    oneOf: [
      { $ref: getSchemaPath(AnonCredsCredentialDefinitionOptionsDto) },
      { $ref: getSchemaPath(SdJwtCredentialDefinitionOptionsDto) },
      { $ref: getSchemaPath(MdlCredentialDefinitionOptionsDto) },
      { $ref: getSchemaPath(W3cVcCredentialDefinitionOptionsDto) },
    ],
    discriminator: { propertyName: 'format' },
  })
  public options!: Record<string, unknown>;

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
    dto.connectorId = credentialDefinition.connectorId ?? null;
    dto.registrationState =
      credentialDefinition.registrationState ?? 'unverified';
    dto.registrationOperationId =
      credentialDefinition.registrationOperationId ?? null;
    dto.issuer = credentialDefinition.registration
      ? { id: credentialDefinition.registration.issuerId }
      : null;
    dto.schema = credentialDefinition.registration
      ? {
          id:
            credentialDefinition.registration.schema?.state === 'finished'
              ? (credentialDefinition.registration.schema.id ?? null)
              : null,
        }
      : null;
    dto.connectorType = credentialDefinition.connectorType;
    dto.isActive = credentialDefinition.isActive;
    dto.metadata = credentialDefinition.metadata;
    dto.options = credentialDefinition.options;
    dto.createdAt = credentialDefinition.createdAt;
    dto.updatedAt = credentialDefinition.updatedAt;
    return dto;
  }
}
