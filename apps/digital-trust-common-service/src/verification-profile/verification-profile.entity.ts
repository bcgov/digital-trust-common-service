import { ApiProperty } from '@nestjs/swagger';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import { IssuanceProfile } from '../issuance-profile/issuance-profile.entity';
import { Tenant } from '../tenant/tenant.entity';

export enum VerificationProfileProtocolHint {
  DIDCOMM = 'didcomm',
  OID4VP = 'oid4vp',
  AUTO = 'auto',
}

export enum VerificationProfileStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  DEPRECATED = 'deprecated',
}

@Entity({ name: 'verification_profile' })
@Unique('uq_verification_profile_tenant_name_version', [
  'tenantId',
  'name',
  'version',
])
@Index('idx_verification_profile_tenant_status', ['tenantId', 'status'])
@Index('idx_verification_profile_issuance_profile_id', ['issuanceProfileId'])
export class VerificationProfile {
  @ApiProperty({
    description: 'The unique identifier of the verification profile',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @ApiProperty({
    description: 'The tenant ID this verification profile belongs to',
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
    description: 'Issuance profile this verification profile is linked to',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ name: 'issuance_profile_id', type: 'uuid' })
  public issuanceProfileId!: string;

  @ManyToOne(() => IssuanceProfile, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'issuance_profile_id' })
  public issuanceProfile!: IssuanceProfile;

  @ApiProperty({
    description: 'Human-friendly profile identifier',
    example: 'age-verification',
  })
  @Column({ type: 'varchar', length: 100 })
  public name!: string;

  @ApiProperty({
    description: 'Semver-like profile version',
    example: '1.0',
  })
  @Column({ type: 'varchar', length: 20 })
  public version!: string;

  @ApiProperty({
    description: 'Optional display description',
    required: false,
    nullable: true,
  })
  @Column({ type: 'text', nullable: true })
  public description?: string | null;

  @ApiProperty({
    description: 'Pre-built proof request template (DIF PE / format-agnostic)',
    example: { id: 'age-over-18', input_descriptors: [] },
  })
  @Column({ name: 'presentation_definition', type: 'jsonb' })
  public presentationDefinition!: Record<string, unknown>;

  @ApiProperty({
    description: 'Quick-reference subset of issuance attribute names',
    required: false,
    nullable: true,
    type: [String],
  })
  @Column({
    name: 'requested_attributes',
    type: 'text',
    array: true,
    nullable: true,
  })
  public requestedAttributes?: string[] | null;

  @ApiProperty({
    description: 'Predicate constraints for proof requests',
    required: false,
    nullable: true,
  })
  @Column({ type: 'jsonb', nullable: true })
  public predicates?: Record<string, unknown>[] | null;

  @ApiProperty({
    description: 'Extensible verifier-specific metadata',
    example: {},
  })
  @Column({ type: 'jsonb', default: () => "'{}'" })
  public metadata!: Record<string, unknown>;

  @ApiProperty({
    description: 'When true, discoverable via public endpoint (CA-14)',
    example: false,
  })
  @Column({ name: 'public', type: 'boolean', default: false })
  public isPublic!: boolean;

  @ApiProperty({
    description: 'Preferred presentation protocol',
    enum: VerificationProfileProtocolHint,
    example: VerificationProfileProtocolHint.AUTO,
  })
  @Column({
    name: 'protocol_hint',
    type: 'enum',
    enum: VerificationProfileProtocolHint,
    enumName: 'verification_profile_protocol_hint',
    default: VerificationProfileProtocolHint.AUTO,
  })
  public protocolHint!: VerificationProfileProtocolHint;

  @ApiProperty({
    description: 'Lifecycle status of the profile',
    enum: VerificationProfileStatus,
    example: VerificationProfileStatus.DRAFT,
  })
  @Column({
    type: 'enum',
    enum: VerificationProfileStatus,
    enumName: 'verification_profile_status',
    default: VerificationProfileStatus.DRAFT,
  })
  public status!: VerificationProfileStatus;

  @ApiProperty({
    description: 'When the profile was created',
    example: '2024-01-01T00:00:00Z',
  })
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
  })
  public createdAt!: Date;

  @ApiProperty({
    description: 'When the profile was last updated',
    example: '2024-01-01T00:00:00Z',
  })
  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
  })
  public updatedAt!: Date;
}
