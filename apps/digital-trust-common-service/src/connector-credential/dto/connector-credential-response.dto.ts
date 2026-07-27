import { ApiProperty } from '@nestjs/swagger';

export class ConnectorCredentialResponseDto {
  @ApiProperty({
    description: 'The unique identifier of the connector credential',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public id!: string;

  @ApiProperty({
    description: 'The tenant ID this credential belongs to',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public tenantId!: string;

  @ApiProperty({
    description: 'The type of connector',
    example: 'traction',
  })
  public connectorType!: string;

  @ApiProperty({
    description: 'The endpoint URL for this connector',
    example: 'https://api.salesforce.com/v57.0',
  })
  public endpointUrl!: string;

  @ApiProperty({
    description: 'Whether this credential is currently active',
    example: true,
  })
  public active!: boolean;

  @ApiProperty({
    description: 'The version of the encryption key used',
    example: 1,
  })
  public keyVersion!: number;

  @ApiProperty({
    description: 'The date and time when the connector credential was created',
    example: '2024-01-01T00:00:00Z',
  })
  public createdAt!: Date;

  @ApiProperty({
    description:
      'The date and time when the connector credential was last updated',
    example: '2024-01-15T00:00:00Z',
  })
  public updatedAt!: Date;
}
