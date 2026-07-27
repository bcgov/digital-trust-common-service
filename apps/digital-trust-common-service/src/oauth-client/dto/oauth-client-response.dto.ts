import { ApiProperty } from '@nestjs/swagger';

export class OAuthClientResponseDto {
  @ApiProperty({
    description: 'The unique identifier of the OAuth client',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public id!: string;

  @ApiProperty({
    description: 'The tenant ID this client belongs to',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public tenantId!: string;

  @ApiProperty({
    description: 'The OAuth client ID',
    example: 'client-123-abc',
  })
  public clientId!: string;

  @ApiProperty({
    description: 'The human-readable name of the OAuth client',
    example: 'Mobile App',
  })
  public name!: string;

  @ApiProperty({
    description: 'Array of OAuth scopes allowed for this client',
    example: ['read:connections', 'write:credentials'],
  })
  public scopes!: string[];

  @ApiProperty({
    description: 'Array of allowed redirect URIs',
    example: ['https://app.example.com/callback'],
  })
  public redirectUris!: string[];

  @ApiProperty({
    description: 'Array of allowed grant types',
    example: ['client_credentials'],
  })
  public grantTypes!: string[];

  @ApiProperty({
    description: 'ID of the user who created this client',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
    nullable: true,
  })
  public createdBy?: string;

  @ApiProperty({
    description: 'The date and time when the OAuth client was created',
    example: '2024-01-01T00:00:00Z',
  })
  public createdAt!: Date;

  @ApiProperty({
    description: 'The date and time when the OAuth client was revoked',
    example: '2024-01-15T00:00:00Z',
    required: false,
    nullable: true,
  })
  public revokedAt?: Date;
}
