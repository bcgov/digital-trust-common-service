import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

import { ConnectorType } from '../../connection/connection.entity';

export class CreateConnectorCredentialDto {
  @Expose({ name: 'tenant_id' })
  @ApiProperty({
    name: 'tenant_id',
    description: 'The tenant ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  public tenantId!: string;

  @Expose({ name: 'connector_type' })
  @ApiProperty({
    name: 'connector_type',
    description: 'The connector type',
    enum: ConnectorType,
    example: ConnectorType.TRACTION,
  })
  @IsEnum(ConnectorType)
  public connectorType!: ConnectorType;

  @Expose({ name: 'credentials_plain_text' })
  @ApiProperty({
    name: 'credentials_plain_text',
    description: 'The encrypted credentials in plain text (base64 encoded)',
  })
  @IsString()
  public credentialsPlainText!: string;

  @Expose({ name: 'endpoint_url' })
  @ApiProperty({
    name: 'endpoint_url',
    description: 'The endpoint URL for the connector',
    example: 'https://api.salesforce.com/v57.0',
  })
  @IsString()
  public endpointUrl!: string;

  @Expose()
  @ApiProperty({
    description: 'Whether this credential is active',
    required: false,
    example: true,
  })
  @IsOptional()
  public active?: boolean;
}
