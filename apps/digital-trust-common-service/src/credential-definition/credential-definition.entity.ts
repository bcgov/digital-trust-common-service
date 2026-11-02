import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Check,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import { Tenant } from '../tenant/tenant.entity';

export enum CredentialDefinitionFormat {
  ANONCREDS = 'anoncreds',
  SD_JWT = 'sd-jwt',
  MDL = 'mdl',
  W3C_VC = 'w3c-vc',
}

export enum CredentialDefinitionConnectorType {
  TRACTION = 'traction',
  CREDO = 'credo',
}

export type RegistrationState = 'unverified' | 'pending' | 'ready' | 'failed';

export interface ArtifactProgress {
  id?: string;
  jobId?: string;
  transactionId?: string;
  state?: 'finished' | 'wait' | 'action' | 'failed';
}

export interface DefinitionRegistration {
  issuerId: string;
  schema: ArtifactProgress;
  definition: ArtifactProgress;
  stage?: string;
}

export enum CredentialDefinitionStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  DEPRECATED = 'deprecated',
}

@Entity({ name: 'credential_definition' })
@Check(
  'chk_credential_definition_options_format',
  `"options" ->> 'format' = "format"::text`,
)
@Index(
  'uq_credential_definition_tenant_name_format',
  ['tenantId', 'name', 'format'],
  { unique: true, where: '"is_active" = true' },
)
@Index('idx_credential_definition_format', ['format'])
@Index('idx_credential_definition_tenant_connector', [
  'tenantId',
  'connectorType',
])
@Index('idx_credential_definition_external_id', ['externalId'])
@Index('idx_credential_definition_connector_id', ['connectorId'])
export class CredentialDefinition {
  @ApiProperty({
    description: 'The unique identifier of the credential definition',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @ApiProperty({
    description: 'The tenant ID this credential definition belongs to',
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
    description: 'The name of the credential definition',
    example: 'University Diploma',
  })
  @Column({ type: 'varchar', length: 255 })
  public name!: string;

  @ApiProperty({
    description: 'The format of the credential definition',
    enum: CredentialDefinitionFormat,
    example: CredentialDefinitionFormat.ANONCREDS,
  })
  @Column({
    type: 'enum',
    enum: CredentialDefinitionFormat,
  })
  public format!: CredentialDefinitionFormat;

  @ApiProperty({
    description: 'The schema definition for the credential',
    example: {
      attributes: ['name', 'date', 'signature'],
      version: '1.0',
    },
  })
  @Column({
    name: 'schema_definition',
    type: 'jsonb',
  })
  public schemaDefinition!: Record<string, unknown>;

  @ApiProperty({
    description: 'The external ID from the connector system',
    example: 'cred-def-123456',
  })
  @Column({ name: 'external_id', type: 'text', nullable: true })
  public externalId!: string | null;

  @Column({ name: 'connector_id', type: 'uuid', nullable: true })
  public connectorId?: string | null;

  @Column({
    name: 'registration_state',
    type: 'varchar',
    default: 'unverified',
  })
  public registrationState?: RegistrationState;

  @Column({ name: 'registration_operation_id', type: 'uuid', nullable: true })
  public registrationOperationId?: string | null;

  @ApiProperty({
    description: 'Immutable, normalized format-specific publication options',
    readOnly: true,
  })
  @Column({ type: 'jsonb' })
  public options!: Record<string, unknown>;

  @Column({ name: 'registration', type: 'jsonb', nullable: true })
  public registration?: DefinitionRegistration | null;

  @ApiProperty({
    description: 'The type of connector used for this credential definition',
    enum: CredentialDefinitionConnectorType,
    example: CredentialDefinitionConnectorType.TRACTION,
  })
  @Column({
    name: 'connector_type',
    type: 'enum',
    enum: CredentialDefinitionConnectorType,
  })
  public connectorType!: CredentialDefinitionConnectorType;

  @ApiProperty({
    description: 'The version of this credential definition',
    example: '1.0',
  })
  @Column({ type: 'varchar', length: 255, default: '1.0' })
  public version!: string;

  @ApiProperty({
    description: 'The lifecycle status of this credential definition',
    enum: CredentialDefinitionStatus,
    example: CredentialDefinitionStatus.DRAFT,
  })
  @Column({
    type: 'enum',
    enum: CredentialDefinitionStatus,
    enumName: 'credential_definition_status',
    default: CredentialDefinitionStatus.DRAFT,
  })
  public status!: CredentialDefinitionStatus;

  @ApiPropertyOptional({
    description: 'Free-form client annotations',
    nullable: true,
    example: {
      issuer: 'Example University',
      version: '2.0',
    },
  })
  @Column({
    type: 'jsonb',
    nullable: true,
  })
  public metadata?: Record<string, unknown>;

  @ApiProperty({
    description: 'Whether this credential definition is currently active',
    example: true,
  })
  @Column({
    name: 'is_active',
    type: 'boolean',
    default: true,
  })
  public isActive!: boolean;

  @ApiProperty({
    description: 'The date and time when the credential definition was created',
    example: '2024-01-01T00:00:00Z',
  })
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
  })
  public createdAt!: Date;

  @ApiProperty({
    description:
      'The date and time when the credential definition was last updated',
    example: '2024-01-01T00:00:00Z',
  })
  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
  })
  public updatedAt!: Date;
}

export const isCredentialDefinitionReadyForIssuance = (
  definition: Pick<
    CredentialDefinition,
    'registrationState' | 'externalId' | 'connectorId'
  >,
): boolean =>
  definition.registrationState === 'ready' &&
  Boolean(definition.externalId) &&
  Boolean(definition.connectorId);
