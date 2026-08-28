import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

import { ConnectorType } from '../../connection/connection.entity';
import { ConnectorCredential } from '../connector-credential.entity';

export class ConnectorCredentialResponseDto {
  @ApiProperty({
    description: 'The unique identifier of the connector credential',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public id!: string;

  @Expose({ name: 'tenant_id' })
  @ApiProperty({
    name: 'tenant_id',
    description: 'The tenant ID this credential belongs to',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public tenantId!: string;

  @Expose({ name: 'connector_type' })
  @ApiProperty({
    name: 'connector_type',
    description: 'The type of connector',
    enum: ConnectorType,
    example: ConnectorType.TRACTION,
  })
  public connectorType!: ConnectorType;

  @Expose({ name: 'endpoint_url' })
  @ApiProperty({
    name: 'endpoint_url',
    description: 'The endpoint URL for this connector',
    example: 'https://api.salesforce.com/v57.0',
  })
  public endpointUrl!: string;

  @ApiProperty({
    description: 'Whether this credential is currently active',
    example: true,
  })
  public active!: boolean;

  @Expose({ name: 'key_version' })
  @ApiProperty({
    name: 'key_version',
    description: 'The version of the encryption key used',
    example: 1,
  })
  public keyVersion!: number;

  @Expose({ name: 'created_at' })
  @ApiProperty({
    name: 'created_at',
    description: 'The date and time when the connector credential was created',
    example: '2024-01-01T00:00:00Z',
  })
  public createdAt!: Date;

  @Expose({ name: 'updated_at' })
  @ApiProperty({
    name: 'updated_at',
    description:
      'The date and time when the connector credential was last updated',
    example: '2024-01-15T00:00:00Z',
  })
  public updatedAt!: Date;

  public static fromEntity(
    credential: ConnectorCredential,
  ): ConnectorCredentialResponseDto {
    const dto = new ConnectorCredentialResponseDto();
    dto.id = credential.id;
    dto.tenantId = credential.tenantId;
    dto.connectorType = credential.connectorType;
    dto.endpointUrl = credential.endpointUrl;
    dto.active = credential.active;
    dto.keyVersion = credential.keyVersion;
    dto.createdAt = credential.createdAt;
    dto.updatedAt = credential.updatedAt;
    return dto;
  }
}
