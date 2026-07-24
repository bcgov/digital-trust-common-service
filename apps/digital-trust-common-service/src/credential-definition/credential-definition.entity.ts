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

@Entity({ name: 'credential_definition' })
@Unique('uq_credential_definition_tenant_name_format', [
  'tenantId',
  'name',
  'format',
])
@Index('idx_credential_definition_format', ['format'])
@Index('idx_credential_definition_tenant_connector', [
  'tenantId',
  'connectorType',
])
@Index('idx_credential_definition_external_id', ['externalId'])
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
  @Column({ name: 'external_id', type: 'varchar', length: 255 })
  public externalId!: string;

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
    description: 'Additional metadata for the credential definition',
    example: {
      issuer: 'Example University',
      version: '2.0',
    },
    required: false,
  })
  @Column({
    type: 'jsonb',
    nullable: true,
  })
  public metadata?: Record<string, unknown>;

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
