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

import { Tenant } from '../tenant/tenant.entity';

export enum ConnectorType {
  TRACTION = 'traction',
  CREDO = 'credo',
}

export enum ConnectionState {
  INVITED = 'invited',
  REQUESTED = 'requested',
  RESPONDED = 'responded',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  ABANDONED = 'abandoned',
}

export enum ConnectionProtocol {
  DIDCOMM_V1 = 'didcomm-v1',
  DIDCOMM_V2 = 'didcomm-v2',
  OPENID4VC = 'openid4vc',
}

@Entity({ name: 'connection' })
@Index('idx_connection_tenant_state', ['tenantId', 'state'])
@Index('idx_connection_external_connection_id', ['externalConnectionId'], {
  unique: true,
})
export class Connection {
  @ApiProperty({
    description: 'The unique identifier of the connection',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @ApiProperty({
    description: 'The tenant ID this connection belongs to',
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
    description: 'The external connection ID',
    example: 'ext-conn-123',
  })
  @Column({ name: 'external_connection_id', type: 'varchar', length: 255 })
  public externalConnectionId!: string;

  @ApiProperty({
    description: 'The label of the other party',
    example: 'Alice',
    required: false,
    nullable: true,
  })
  @Column({
    name: 'their_label',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  public theirLabel?: string;

  @ApiProperty({
    description: 'The DID of the other party',
    example: 'did:example:123',
    required: false,
    nullable: true,
  })
  @Column({
    name: 'their_did',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  public theirDid?: string;

  @ApiProperty({
    description: 'The current state of the connection',
    enum: ConnectionState,
    example: ConnectionState.ACTIVE,
  })
  @Column({
    type: 'enum',
    enum: ConnectionState,
  })
  public state!: ConnectionState;

  @ApiProperty({
    description: 'The connector type used for this connection',
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
    description: 'The protocol used for this connection',
    enum: ConnectionProtocol,
    example: ConnectionProtocol.DIDCOMM_V1,
  })
  @Column({
    type: 'enum',
    enum: ConnectionProtocol,
  })
  public protocol!: ConnectionProtocol;

  @ApiProperty({
    description: 'Additional metadata associated with the connection',
    example: { key: 'value' },
  })
  @Column({
    type: 'jsonb',
    default: {},
  })
  public metadata!: Record<string, unknown>;

  @ApiProperty({
    description: 'The date and time when the connection was created',
    example: '2024-01-01T00:00:00Z',
  })
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
  })
  public createdAt!: Date;

  @ApiProperty({
    description: 'The date and time when the connection was last updated',
    example: '2024-01-01T00:00:00Z',
  })
  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
  })
  public updatedAt!: Date;
}
