import { OidcModel } from '@app/oidc/entities/oidc-model.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'oidc_upstream_session' })
@Index('uq_oidc_upstream_session_model', ['oidcModelId'], { unique: true })
@Index('uq_oidc_upstream_session_uid', ['oidcSessionUid'], { unique: true })
@Index('idx_oidc_upstream_session_expires_at', ['expiresAt'])
export class OidcUpstreamSession {
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @OneToOne(() => OidcModel, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'oidc_model_id' })
  public oidcModel?: OidcModel;

  @Column({ name: 'oidc_model_id', type: 'uuid', unique: true, nullable: true })
  public oidcModelId?: string | null;

  @Column({
    name: 'oidc_session_uid',
    type: 'text',
    unique: true,
    nullable: true,
  })
  public oidcSessionUid?: string | null;

  @Column({ name: 'tenant_user_id', type: 'uuid' })
  public tenantUserId!: string;

  @Column({ name: 'upstream_subject', type: 'varchar', length: 255 })
  public upstreamSubject!: string;

  @Column({ name: 'upstream_id_token', type: 'text' })
  public upstreamIdToken!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  public expiresAt?: Date | null;
}
