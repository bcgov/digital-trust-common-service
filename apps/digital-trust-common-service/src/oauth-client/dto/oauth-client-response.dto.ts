import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

import { OAuthClient } from '../oauth-client.entity';

export class OAuthClientResponseDto {
  @ApiProperty({
    description: 'The unique identifier of the OAuth client',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public id!: string;

  @Expose({ name: 'tenant_id' })
  @ApiProperty({
    name: 'tenant_id',
    description: 'The tenant ID this client belongs to',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public tenantId!: string;

  @Expose({ name: 'client_id' })
  @ApiProperty({
    name: 'client_id',
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
    example: ['credentials:offer', 'connections:manage'],
  })
  public scopes!: string[];

  @ApiProperty({
    description:
      'JWT role claims stamped on tokens for this client (machine clients only). Tenant-scoped roles (owner, admin, member, readonly) may be assigned by tenant admins; platform-admin requires a platform-admin caller.',
    example: [],
  })
  public roles!: string[];

  @Expose({ name: 'redirect_uris' })
  @ApiProperty({
    name: 'redirect_uris',
    description: 'Array of allowed redirect URIs',
    example: ['https://app.example.com/callback'],
  })
  public redirectUris!: string[];

  @Expose({ name: 'grant_types' })
  @ApiProperty({
    name: 'grant_types',
    description: 'Array of allowed grant types',
    example: ['client_credentials'],
  })
  public grantTypes!: string[];

  @Expose({ name: 'created_by' })
  @ApiProperty({
    name: 'created_by',
    description: 'ID of the user who created this client',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
    nullable: true,
  })
  public createdBy?: string;

  @Expose({ name: 'refresh_token_ttl_seconds' })
  @ApiProperty({
    name: 'refresh_token_ttl_seconds',
    description:
      'Refresh token lifetime in seconds for this client. Null inherits the server default.',
    example: 28800,
    required: false,
    nullable: true,
  })
  public refreshTokenTtlSeconds?: number | null;

  @Expose({ name: 'created_at' })
  @ApiProperty({
    name: 'created_at',
    description: 'The date and time when the OAuth client was created',
    example: '2024-01-01T00:00:00Z',
  })
  public createdAt!: Date;

  @Expose({ name: 'revoked_at' })
  @ApiProperty({
    name: 'revoked_at',
    description: 'The date and time when the OAuth client was revoked',
    example: '2024-01-15T00:00:00Z',
    required: false,
    nullable: true,
  })
  public revokedAt?: Date | null;

  public static fromEntity(client: OAuthClient): OAuthClientResponseDto {
    const dto = new OAuthClientResponseDto();
    dto.id = client.id;
    dto.tenantId = client.tenantId;
    dto.clientId = client.clientId;
    dto.name = client.name;
    dto.scopes = client.scopes;
    dto.roles = client.roles;
    dto.redirectUris = client.redirectUris;
    dto.grantTypes = client.grantTypes;
    dto.createdBy = client.createdBy;
    dto.refreshTokenTtlSeconds = client.refreshTokenTtlSeconds ?? null;
    dto.createdAt = client.createdAt;
    dto.revokedAt = client.revokedAt;
    return dto;
  }
}
