import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
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

import { Tenant } from '../tenant/tenant.entity';

export enum OperationState {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface OperationRequest {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

export interface OperationFailure {
  code: string;
  message: string;
}

export type OperationResult = Record<string, unknown> | OperationFailure | null;

@Entity({ name: 'operation' })
@Index('idx_operation_tenant_state', ['tenantId', 'state'])
@Index('idx_operation_tenant_type_state', ['tenantId', 'type', 'state'])
@Index('idx_operation_tenant_created_at', ['tenantId', 'createdAt'])
@Index('idx_operation_external_id', ['externalId'])
@Index('idx_operation_expires_at', ['expiresAt'])
@Index('idx_operation_batch_id', ['batchId'])
export class Operation {
  @ApiProperty({
    description: 'The unique identifier of the operation',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @ApiProperty({
    description: 'The tenant this operation belongs to',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @ManyToOne(() => Tenant, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'tenant_id' })
  public tenant!: Tenant;

  @ApiProperty({
    description:
      'The parent batch operation ID, or null for standalone operations',
    example: null,
    required: false,
  })
  @Column({ name: 'batch_id', type: 'uuid', nullable: true })
  public batchId?: string | null;

  @ManyToOne(() => Operation, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'batch_id' })
  public batch?: Operation | null;

  @ApiProperty({
    description: 'The operation type',
    example: 'credential.offer',
  })
  @Column({ type: 'varchar', length: 50 })
  @IsString()
  @Length(1, 50)
  public type!: string;

  @ApiProperty({
    description: 'The current state of the operation',
    enum: OperationState,
    example: OperationState.PENDING,
  })
  @Column({
    type: 'enum',
    enum: OperationState,
    default: OperationState.PENDING,
  })
  @IsEnum(OperationState)
  public state!: OperationState;

  @ApiProperty({
    description:
      'The full request context persisted at creation time (method, path, body)',
    example: {
      method: 'POST',
      path: '/api/v1/tenants/:tenantId/credentials/offer',
      body: {},
    },
  })
  @Column({ type: 'jsonb' })
  @IsObject()
  public request!: OperationRequest;

  @ApiProperty({
    description:
      'State-dependent result data. Null while pending; type-specific when completed; { code, message } when failed.',
    example: null,
    required: false,
  })
  @Column({ type: 'jsonb', nullable: true })
  @IsOptional()
  public result?: OperationResult;

  @ApiProperty({
    description: 'The external identifier from the back-end agent',
    example: 'cred-exchange-123',
    required: false,
  })
  @Column({ name: 'external_id', type: 'varchar', length: 255, nullable: true })
  @IsOptional()
  @IsString()
  public externalId?: string | null;

  @ApiProperty({
    description: 'The date and time when the operation was first viewed',
    example: null,
    required: false,
  })
  @Column({ name: 'viewed_at', type: 'timestamptz', nullable: true })
  public viewedAt?: Date | null;

  @ApiProperty({
    description:
      'The date and time when the operation expires and may be purged',
    example: '2024-01-04T00:00:00Z',
  })
  @Column({ name: 'expires_at', type: 'timestamptz' })
  public expiresAt!: Date;

  @ApiProperty({
    description: 'The date and time when the operation was created',
    example: '2024-01-01T00:00:00Z',
  })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @ApiProperty({
    description: 'The date and time when the operation was last updated',
    example: '2024-01-01T00:00:00Z',
  })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}
