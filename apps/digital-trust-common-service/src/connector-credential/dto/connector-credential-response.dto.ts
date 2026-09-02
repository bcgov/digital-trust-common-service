import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

import { ConnectorType } from '../../connection/connection.entity';
import { ConnectorCredential } from '../connector-credential.entity';

export class ConnectorCredentialResponseDto {
  @Expose()
  @ApiProperty({
    description: 'The unique identifier of the connector credential',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public id!: string;

  @Expose({ name: 'tenant_id' })
  @ApiProperty({
    description: 'The tenant ID this credential belongs to',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public tenantId!: string;

  @Expose({ name: 'connector_type' })
  @ApiProperty({
    description: 'The type of connector',
    enum: ConnectorType,
    example: ConnectorType.TRACTION,
  })
  public connectorType!: ConnectorType;

  @Expose({ name: 'endpoint_url' })
  @ApiProperty({
    description: 'The endpoint URL for this connector',
    example: 'https://api.salesforce.com/v57.0',
  })
  public endpointUrl!: string;

  @Expose()
  @ApiProperty({
    description: 'Whether this credential is currently active',
    example: true,
  })
  public active!: boolean;

  @Expose({ name: 'created_at' })
  @ApiProperty({
    description: 'The date and time when the connector credential was created',
    example: '2024-01-01T00:00:00Z',
  })
  public createdAt!: Date;

  @Expose({ name: 'updated_at' })
  @ApiProperty({
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
    dto.createdAt = credential.createdAt;
    dto.updatedAt = credential.updatedAt;
    return dto;
  }
}
