import { ApiProperty } from '@nestjs/swagger';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import { Operation } from '../operation/operation.entity';
import { Tenant } from '../tenant/tenant.entity';

export enum AuditActorType {
  USER = 'user',
  SYSTEM = 'system',
  CLIENT = 'client',
}

export enum AuditAction {
  ISSUE = 'issue',
  VERIFY = 'verify',
  HOLD = 'hold',
  REVOKE = 'revoke',
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LOGIN = 'login',
  TOKEN_GRANT = 'token_grant',
}

@Entity({ name: 'audit_log' })
@Index('idx_audit_log_tenant_created', ['tenantId', 'createdAt'])
@Index('idx_audit_log_resource', ['resourceType', 'resourceId'])
@Index('idx_audit_log_operation_id', ['operationId'])
export class AuditLog {
  @ApiProperty({
    description: 'The unique identifier of the audit log entry',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @ApiProperty({
    description: 'The tenant ID this audit entry belongs to',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @ManyToOne(() => Tenant, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'tenant_id' })
  public tenant!: Tenant;

  @ApiProperty({
    description: 'Actor identifier (user ID, client ID, or system)',
    example: 'user-123',
  })
  @Column({ name: 'actor_id', type: 'varchar', length: 255 })
  public actorId!: string;

  @ApiProperty({
    description: 'Actor type',
    enum: AuditActorType,
    example: AuditActorType.USER,
  })
  @Column({
    name: 'actor_type',
    type: 'enum',
    enum: AuditActorType,
  })
  public actorType!: AuditActorType;

  @ApiProperty({
    description: 'Audited action',
    enum: AuditAction,
    example: AuditAction.ISSUE,
  })
  @Column({
    type: 'enum',
    enum: AuditAction,
  })
  public action!: AuditAction;

  @ApiProperty({
    description: 'Resource type',
    example: 'credential',
  })
  @Column({ name: 'resource_type', type: 'varchar', length: 100 })
  public resourceType!: string;

  @ApiProperty({
    description: 'Resource ID',
    example: '123e4567-e89b-12d3-a456-426614174002',
  })
  @Column({ name: 'resource_id', type: 'uuid' })
  public resourceId!: string;

  @ApiProperty({
    description: 'Linked operation ID, when applicable',
    required: false,
    nullable: true,
  })
  @Column({ name: 'operation_id', type: 'uuid', nullable: true })
  public operationId?: string | null;

  @ManyToOne(() => Operation, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'operation_id' })
  public operation?: Operation | null;

  @ApiProperty({
    description: 'Additional context metadata',
    example: {},
  })
  @Column({
    type: 'jsonb',
    default: {},
  })
  public metadata!: Record<string, unknown>;

  @ApiProperty({
    description: 'Client IP address',
    required: false,
    nullable: true,
  })
  @Column({
    name: 'ip_address',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  public ipAddress?: string | null;

  @ApiProperty({
    description: 'When the audit entry was created',
  })
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
    primary: true,
  })
  public createdAt!: Date;
}
