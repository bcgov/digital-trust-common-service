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

export enum TenantUserRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
  READONLY = 'readonly',
}

export enum TenantUserStatus {
  ACTIVE = 'active',
  INVITED = 'invited',
  DISABLED = 'disabled',
}

@Entity({ name: 'tenant_user' })
@Unique('uq_tenant_user_external_user', ['tenantId', 'externalUserId'])
@Index('idx_tenant_user_tenant_id', ['tenantId'])
@Index('idx_tenant_user_external_user_id', ['externalUserId'])
export class TenantUser {
  @ApiProperty({
    description: 'The unique identifier of the tenant user',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @ApiProperty({
    description: 'The tenant ID this user belongs to',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @ManyToOne(() => Tenant, (tenant) => tenant.users, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'tenant_id' })
  public tenant!: Tenant;

  @ApiProperty({
    description: 'The external user ID (Keycloak subject)',
    example: 'keycloak-user-123',
  })
  @Column({ name: 'external_user_id', type: 'varchar', length: 255 })
  public externalUserId!: string;

  @ApiProperty({
    description: 'The email address of the user',
    example: 'user@example.com',
  })
  @Column({ type: 'varchar', length: 255 })
  public email!: string;

  @ApiProperty({
    description: 'The display name of the user',
    example: 'John Doe',
    required: false,
  })
  @Column({
    name: 'display_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  public displayName?: string;

  @ApiProperty({
    description: 'The role of the user within the tenant',
    enum: TenantUserRole,
    example: TenantUserRole.MEMBER,
  })
  @Column({
    type: 'enum',
    enum: TenantUserRole,
    default: TenantUserRole.MEMBER,
  })
  public role!: TenantUserRole;

  @ApiProperty({
    description: 'The status of the user',
    enum: TenantUserStatus,
    example: TenantUserStatus.ACTIVE,
  })
  @Column({
    type: 'enum',
    enum: TenantUserStatus,
    default: TenantUserStatus.INVITED,
  })
  public status!: TenantUserStatus;

  @ApiProperty({
    description: 'The date and time when the tenant user was created',
    example: '2024-01-01T00:00:00Z',
  })
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
  })
  public createdAt!: Date;

  @ApiProperty({
    description: 'The date and time when the tenant user was last updated',
    example: '2024-01-01T00:00:00Z',
  })
  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
  })
  public updatedAt!: Date;
}
