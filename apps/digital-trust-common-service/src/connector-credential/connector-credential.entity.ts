import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ConnectorType } from '../connection/connection.entity';
import { Tenant } from '../tenant/tenant.entity';

@Entity({ name: 'connector_credential' })
@Index('idx_connector_credential_lookup', [
  'tenantId',
  'connectorType',
  'active',
])
@Index('idx_connector_credential_tenant', ['tenantId'])
export class ConnectorCredential {
  @ApiProperty({
    description: 'The unique identifier of the connector credential',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @ApiProperty({
    description: 'The tenant ID this credential belongs to',
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
    description: 'The type of connector',
    enum: ConnectorType,
    example: ConnectorType.TRACTION,
  })
  @Column({
    name: 'connector_type',
    type: 'enum',
    enum: ConnectorType,
  })
  public connectorType!: ConnectorType;

  @ApiProperty({
    description: 'The encrypted credentials for this connector',
    type: 'string',
    format: 'binary',
  })
  @Column({
    name: 'credentials_encrypted',
    type: 'bytea',
  })
  public credentialsEncrypted!: Buffer<ArrayBufferLike>;

  @ApiProperty({
    description: 'The endpoint URL for this connector',
    example: 'https://api.salesforce.com/v57.0',
  })
  @Column({
    name: 'endpoint_url',
    type: 'text',
  })
  public endpointUrl!: string;

  @ApiProperty({
    description: 'Whether this credential is currently active',
    example: true,
  })
  @Column({
    type: 'boolean',
    default: true,
  })
  public active!: boolean;

  @ApiProperty({
    description: 'The version of the encryption key used',
    example: 1,
  })
  @Column({
    name: 'key_version',
    type: 'integer',
    default: 1,
  })
  public keyVersion!: number;

  @ApiProperty({
    description: 'The date and time when the connector credential was created',
    example: '2024-01-01T00:00:00Z',
  })
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
  })
  public createdAt!: Date;

  @ApiProperty({
    description:
      'The date and time when the connector credential was last updated',
    example: '2024-01-15T00:00:00Z',
  })
  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
  })
  public updatedAt!: Date;
}
