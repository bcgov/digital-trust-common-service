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

import { ConnectorCredential } from '../connector-credential/connector-credential.entity';
import {
  CredentialDefinition,
  CredentialDefinitionFormat,
} from '../credential-definition/credential-definition.entity';
import { Tenant } from '../tenant/tenant.entity';

export enum IssuanceProfileProtocolHint {
  DIDCOMM = 'didcomm',
  OID4VCI = 'oid4vci',
  AUTO = 'auto',
}

export enum IssuanceProfileStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  DEPRECATED = 'deprecated',
}

@Entity({ name: 'issuance_profile' })
@Unique('uq_issuance_profile_tenant_name_version', [
  'tenantId',
  'name',
  'version',
])
@Index('idx_issuance_profile_tenant_status', ['tenantId', 'status'])
@Index('idx_issuance_profile_credential_definition_id', [
  'credentialDefinitionId',
])
export class IssuanceProfile {
  @ApiProperty({
    description: 'The unique identifier of the issuance profile',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @ApiProperty({
    description: 'The tenant ID this issuance profile belongs to',
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
    description: 'Human-friendly profile identifier',
    example: 'drivers-license',
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
    description: 'Credential definition this profile wraps',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ name: 'credential_definition_id', type: 'uuid' })
  public credentialDefinitionId!: string;

  @ManyToOne(() => CredentialDefinition, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'credential_definition_id' })
  public credentialDefinition!: CredentialDefinition;

  @ApiProperty({
    description:
      'Denormalized credential format copied from the credential definition',
    enum: CredentialDefinitionFormat,
    example: CredentialDefinitionFormat.ANONCREDS,
  })
  @Column({
    type: 'enum',
    enum: CredentialDefinitionFormat,
    enumName: 'credential_definition_format',
  })
  public format!: CredentialDefinitionFormat;

  @ApiProperty({
    description: 'Connector credential that handles this profile',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
    nullable: true,
  })
  @Column({ name: 'connector_id', type: 'uuid', nullable: true })
  public connectorId?: string | null;

  @ManyToOne(() => ConnectorCredential, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'connector_id' })
  public connector?: ConnectorCredential | null;

  @ApiProperty({
    description: 'Attributes/claims the consumer must supply',
    example: { attributes: ['given_name', 'family_name'] },
  })
  @Column({ name: 'attribute_schema', type: 'jsonb' })
  public attributeSchema!: Record<string, unknown>;

  @ApiProperty({
    description: 'Pre-filled attribute values',
    required: false,
    nullable: true,
  })
  @Column({ type: 'jsonb', nullable: true })
  public defaults?: Record<string, unknown> | null;

  @ApiProperty({
    description: 'UI/metadata display hints',
    required: false,
    nullable: true,
  })
  @Column({ type: 'jsonb', nullable: true })
  public display?: Record<string, unknown> | null;

  @ApiProperty({
    description: 'Extensible issuer-specific metadata',
    example: {},
  })
  @Column({ type: 'jsonb', default: () => "'{}'" })
  public metadata!: Record<string, unknown>;

  @ApiProperty({
    description: 'Preferred delivery protocol',
    enum: IssuanceProfileProtocolHint,
    example: IssuanceProfileProtocolHint.AUTO,
  })
  @Column({
    name: 'protocol_hint',
    type: 'enum',
    enum: IssuanceProfileProtocolHint,
    enumName: 'issuance_profile_protocol_hint',
    default: IssuanceProfileProtocolHint.AUTO,
  })
  public protocolHint!: IssuanceProfileProtocolHint;

  @ApiProperty({
    description: 'Lifecycle status of the profile',
    enum: IssuanceProfileStatus,
    example: IssuanceProfileStatus.DRAFT,
  })
  @Column({
    type: 'enum',
    enum: IssuanceProfileStatus,
    enumName: 'issuance_profile_status',
    default: IssuanceProfileStatus.DRAFT,
  })
  public status!: IssuanceProfileStatus;

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
