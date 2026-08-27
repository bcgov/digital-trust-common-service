import { ApiProperty } from '@nestjs/swagger';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import { Tenant } from '../tenant/tenant.entity';

export enum OAuthClientRevokedReason {
  /**
   * Set when this client was bulk-revoked as a side effect of its tenant
   * being deactivated. Reactivating the tenant auto-restores only clients
   * with this reason — clients revoked individually for cause (reason left
   * null) are never resurrected by a tenant status change.
   */
  TENANT_DEACTIVATION = 'tenant_deactivation',
}

@Entity({ name: 'oauth_client' })
@Index('idx_oauth_client_tenant', ['tenantId'])
export class OAuthClient {
  @ApiProperty({
    description: 'The unique identifier of the OAuth client',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @ApiProperty({
    description: 'The tenant ID this client belongs to',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @ManyToOne(() => Tenant, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'tenant_id' })
  public tenant!: Tenant;

  @ApiProperty({
    description: 'The OAuth client ID',
    example: 'client-123-abc',
  })
  @Column({ name: 'client_id', type: 'varchar', length: 255, unique: true })
  public clientId!: string;

  /**
   * NULL for public (PKCE) clients, which have no secret to hash. The
   * `chk_oauth_client_secret_matches_kind` constraint keeps this in lockstep
   * with `isPublic`.
   */
  @Column({ name: 'client_secret_hash', type: 'text', nullable: true })
  public clientSecretHash?: string | null;

  @ApiProperty({
    description:
      'Whether this is a public (PKCE) client — a browser or native app that cannot hold a secret. Public clients authenticate with PKCE alone (token_endpoint_auth_method=none) and are never issued a client secret.',
    example: false,
  })
  @Column({
    name: 'is_public',
    type: 'boolean',
    default: false,
  })
  public isPublic!: boolean;

  @ApiProperty({
    description: 'The human-readable name of the OAuth client',
    example: 'Mobile App',
  })
  @Column({ type: 'varchar', length: 255 })
  public name!: string;

  @ApiProperty({
    description: 'Array of OAuth scopes allowed for this client',
    example: ['credentials:offer', 'connections:manage'],
  })
  @Column({
    type: 'text',
    array: true,
    default: [],
  })
  public scopes!: string[];

  @ApiProperty({
    description:
      'JWT role claims stamped on tokens issued to this client (machine / client_credentials clients only). Tenant-scoped roles may be assigned by tenant admins; platform-admin requires a platform-admin caller.',
    example: [],
    required: false,
  })
  @Column({
    type: 'text',
    array: true,
    default: [],
  })
  public roles!: string[];

  @ApiProperty({
    description: 'Array of allowed redirect URIs',
    example: ['https://app.example.com/callback'],
  })
  @Column({
    name: 'redirect_uris',
    type: 'text',
    array: true,
    default: [],
  })
  public redirectUris!: string[];

  @ApiProperty({
    description:
      'Array of allowed RP-initiated logout return URIs. Kept separate from redirectUris so a sign-out cannot be redirected onto the login callback route.',
    example: ['https://app.example.com/login'],
  })
  @Column({
    name: 'post_logout_redirect_uris',
    type: 'text',
    array: true,
    default: [],
  })
  public postLogoutRedirectUris!: string[];

  @ApiProperty({
    description: 'Array of allowed grant types',
    example: ['client_credentials'],
  })
  @Column({
    name: 'grant_types',
    type: 'text',
    array: true,
    default: ['client_credentials'],
  })
  public grantTypes!: string[];

  @ApiProperty({
    description: 'ID of the user who created this client',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
    nullable: true,
  })
  @Column({
    name: 'created_by',
    type: 'uuid',
    nullable: true,
  })
  public createdBy?: string;

  @ApiProperty({
    description: 'The date and time when the OAuth client was created',
    example: '2024-01-01T00:00:00Z',
  })
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
  })
  public createdAt!: Date;

  @ApiProperty({
    description:
      'Refresh token lifetime in seconds for this client. When null, the server-wide default (OIDC_REFRESH_TOKEN_TTL_SECONDS) applies.',
    example: 3600,
    required: false,
    nullable: true,
  })
  @Column({
    name: 'refresh_token_ttl_seconds',
    type: 'int',
    nullable: true,
  })
  public refreshTokenTtlSeconds?: number | null;

  @ApiProperty({
    description: 'The date and time when the OAuth client was revoked',
    example: '2024-01-15T00:00:00Z',
    required: false,
    nullable: true,
  })
  @Column({
    name: 'revoked_at',
    type: 'timestamptz',
    nullable: true,
  })
  public revokedAt?: Date | null;

  @ApiProperty({
    description:
      'Reason this client was revoked, when revoked as a side effect of a tenant lifecycle change. Null for manually revoked clients and clients that were never revoked.',
    enum: OAuthClientRevokedReason,
    example: OAuthClientRevokedReason.TENANT_DEACTIVATION,
    required: false,
    nullable: true,
  })
  @Column({
    name: 'revoked_reason',
    type: 'enum',
    enum: OAuthClientRevokedReason,
    nullable: true,
  })
  public revokedReason?: OAuthClientRevokedReason | null;
}
