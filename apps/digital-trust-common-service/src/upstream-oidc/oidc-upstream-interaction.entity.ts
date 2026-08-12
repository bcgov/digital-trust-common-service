import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'oidc_upstream_interaction' })
@Index('idx_oidc_upstream_interaction_expires_at', ['expiresAt'])
export class OidcUpstreamInteraction {
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @Column({ type: 'text', unique: true })
  public state!: string;

  @Column({ type: 'text' })
  public nonce!: string;

  @Column({ name: 'interaction_uid', type: 'text' })
  public interactionUid!: string;

  @Column({ name: 'code_verifier', type: 'text' })
  public codeVerifier!: string;

  @Column({ name: 'tenant_id', type: 'text' })
  public tenantId!: string;

  @Column({ name: 'tenant_user_id', type: 'text' })
  public tenantUserId?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  public expiresAt!: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  public consumedAt?: Date;
}
