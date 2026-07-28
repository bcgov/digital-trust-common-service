import { ApiProperty } from '@nestjs/swagger';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import { Connection } from '../connection/connection.entity';
import { ConnectorCredential } from '../connector-credential/connector-credential.entity';
import { CredentialDefinitionFormat } from '../credential-definition/credential-definition.entity';
import { IssuanceProfile } from '../issuance-profile/issuance-profile.entity';
import { Operation } from '../operation/operation.entity';
import { Tenant } from '../tenant/tenant.entity';

export enum CredentialState {
  OFFERED = 'offered',
  ISSUED = 'issued',
  REVOKED = 'revoked',
  EXPIRED = 'expired',
}

@Entity({ name: 'credential' })
@Index('idx_credential_tenant_state', ['tenantId', 'state'])
@Index('idx_credential_issuance_profile_id', ['issuanceProfileId'])
@Index('idx_credential_connection_id', ['connectionId'])
@Index('idx_credential_connector_id', ['connectorId'])
export class Credential {
  @ApiProperty({
    description: 'The unique identifier of the credential record',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @ApiProperty({
    description: 'The tenant this credential belongs to',
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
    description:
      'Issuance profile used to issue (null for legacy credential_definition mode)',
    required: false,
    nullable: true,
  })
  @Column({ name: 'issuance_profile_id', type: 'uuid', nullable: true })
  public issuanceProfileId?: string | null;

  @ManyToOne(() => IssuanceProfile, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'issuance_profile_id' })
  public issuanceProfile?: IssuanceProfile | null;

  @ApiProperty({
    description:
      'Connection used for DIDComm issuance (null for OID4VCI / connectionless)',
    required: false,
    nullable: true,
  })
  @Column({ name: 'connection_id', type: 'uuid', nullable: true })
  public connectionId?: string | null;

  @ManyToOne(() => Connection, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'connection_id' })
  public connection?: Connection | null;

  @ApiProperty({
    description: 'Connector credential that issued this credential',
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
    description: 'Adapter-assigned exchange / credential id',
    required: false,
    nullable: true,
  })
  @Column({ name: 'external_id', type: 'varchar', length: 255, nullable: true })
  public externalId?: string | null;

  @ApiProperty({
    description: 'Credential format',
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
    description: 'Lifecycle state of the credential record',
    enum: CredentialState,
    example: CredentialState.OFFERED,
  })
  @Column({
    type: 'enum',
    enum: CredentialState,
    enumName: 'credential_state',
    default: CredentialState.OFFERED,
  })
  public state!: CredentialState;

  @ApiProperty({
    description: 'Offer operation that created this credential record',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ name: 'operation_id', type: 'uuid' })
  public operationId!: string;

  @ManyToOne(() => Operation, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'operation_id' })
  public operation!: Operation;

  @ApiProperty({
    description:
      'Adapter-specific metadata (legacy mode may store credential_definition_id here)',
    example: {},
  })
  @Column({ type: 'jsonb', default: () => "'{}'" })
  public metadata!: Record<string, unknown>;

  @ApiProperty({
    description: 'When the credential was issued (webhook confirmation)',
    required: false,
    nullable: true,
  })
  @Column({ name: 'issued_at', type: 'timestamptz', nullable: true })
  public issuedAt?: Date | null;

  @ApiProperty({
    description: 'When the credential was revoked',
    required: false,
    nullable: true,
  })
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  public revokedAt?: Date | null;

  @ApiProperty({
    description: 'When the record was created',
    example: '2024-01-01T00:00:00Z',
  })
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
  })
  public createdAt!: Date;

  @ApiProperty({
    description: 'When the record was last updated',
    example: '2024-01-01T00:00:00Z',
  })
  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
  })
  public updatedAt!: Date;
}
