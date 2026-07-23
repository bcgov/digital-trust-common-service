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

  @Column({ name: 'client_secret_hash', type: 'text' })
  public clientSecretHash!: string;

  @ApiProperty({
    description: 'The human-readable name of the OAuth client',
    example: 'Mobile App',
  })
  @Column({ type: 'varchar', length: 255 })
  public name!: string;

  @ApiProperty({
    description: 'Array of OAuth scopes allowed for this client',
    example: ['read:connections', 'write:credentials'],
  })
  @Column({
    type: 'text',
    array: true,
    default: [],
  })
  public scopes!: string[];

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
  public revokedAt?: Date;
}
