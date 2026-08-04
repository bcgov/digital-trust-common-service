import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Generic storage row for oidc-provider's session/grant model kinds
 * (Session, AuthorizationCode, AccessToken, RefreshToken, DeviceCode,
 * Interaction, ReplayDetection, PushedAuthorizationRequest, etc).
 *
 * Mirrors migration `000012_create-oidc-model`. Client credentials are
 * NOT stored here, see `OAuthClient` / `OAuthClientService`.
 */
@Entity({ name: 'oidc_model' })
@Index('idx_oidc_model_grant_id', ['modelName', 'grantId'])
@Index('idx_oidc_model_user_code', ['modelName', 'userCode'])
@Index('idx_oidc_model_uid', ['modelName', 'uid'])
@Index('idx_oidc_model_expires_at', ['expiresAt'])
export class OidcModel {
  @ApiProperty({
    description: 'The unique identifier of this stored oidc-provider record',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @ApiProperty({
    description:
      'The oidc-provider model kind, e.g. Session, AccessToken, RefreshToken',
    example: 'AccessToken',
  })
  @Column({ name: 'model_name', type: 'varchar', length: 50 })
  public modelName!: string;

  @ApiProperty({
    description: "The identifier oidc-provider assigned to this model's data",
    example: 'aTc4qzcVW1_o71OyGTaEs',
  })
  @Column({ name: 'oidc_id', type: 'varchar', length: 255 })
  public oidcId!: string;

  @ApiProperty({
    description: "The oidc-provider model's serialized payload",
  })
  @Column({ type: 'jsonb' })
  public payload!: Record<string, unknown>;

  @ApiProperty({
    description: 'The grant this record belongs to, if any',
    required: false,
    nullable: true,
  })
  @Column({ name: 'grant_id', type: 'varchar', length: 255, nullable: true })
  public grantId?: string | null;

  @ApiProperty({
    description: 'The device flow user code, if any',
    required: false,
    nullable: true,
  })
  @Column({ name: 'user_code', type: 'varchar', length: 255, nullable: true })
  public userCode?: string | null;

  @ApiProperty({
    description: 'The session uid, if any',
    required: false,
    nullable: true,
  })
  @Column({ type: 'varchar', length: 255, nullable: true })
  public uid?: string | null;

  @ApiProperty({
    description: 'When this record expires and becomes eligible for purge',
    required: false,
    nullable: true,
  })
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  public expiresAt?: Date | null;

  @ApiProperty({
    description: 'When this record was consumed (e.g. an auth code)',
    required: false,
    nullable: true,
  })
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  public consumedAt?: Date | null;

  @ApiProperty({
    description: 'The date and time when this record was created',
    example: '2024-01-01T00:00:00Z',
  })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;
}
