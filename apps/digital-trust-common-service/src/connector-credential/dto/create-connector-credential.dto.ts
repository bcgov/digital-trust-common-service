import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
} from 'class-validator';

import { ConnectorType } from '../../connection/connection.entity';

export class ConnectorCredentialsDto {
  @ApiProperty({
    description: 'The API key used to authenticate with the agent endpoint',
    example: 'sk_live_abc123',
  })
  @IsString()
  @IsNotEmpty()
  public apiKey!: string;

  @ApiProperty({
    description:
      'The Traction sub-tenant ID this credential maps to (Traction connectors only)',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    required: false,
  })
  @IsOptional()
  @IsString()
  public tractionTenantId?: string;
}

export class CreateConnectorCredentialDto {
  @Expose({ name: 'connector_type' })
  @ApiProperty({
    description: 'The connector type',
    enum: ConnectorType,
    example: ConnectorType.TRACTION,
  })
  @IsEnum(ConnectorType)
  public connectorType!: ConnectorType;

  @Expose({ name: 'endpoint_url' })
  @ApiProperty({
    description: 'The endpoint URL for the connector agent',
    example: 'https://traction.example.com/api',
  })
  @IsUrl()
  public endpointUrl!: string;

  @Expose()
  @ApiProperty({
    description:
      'The connector-specific credentials. Encrypted at rest and never returned after creation.',
    type: ConnectorCredentialsDto,
  })
  @ValidateNested()
  @Type(() => ConnectorCredentialsDto)
  public credentials!: ConnectorCredentialsDto;
}
