import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  IsObject,
} from 'class-validator';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  OneToMany,
} from 'typeorm';

import { TenantUser } from '../tenant-user/tenant-user.entity';

export enum TenantStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  DEACTIVATED = 'deactivated',
}

@Entity('tenant')
@Index('idx_tenant_slug', ['slug'], { unique: true })
@Index('idx_tenant_status', ['status'])
export class Tenant {
  @ApiProperty({
    description: 'The unique identifier of the tenant',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @ApiProperty({
    description: 'The name of the tenant',
    example: 'Acme Corporation',
  })
  @Column({
    length: 255,
  })
  @IsString()
  @Length(1, 255)
  public name!: string;

  @ApiProperty({
    description: 'A unique slug for the tenant',
    example: 'acme-corp',
  })
  @Column({
    length: 100,
    unique: true,
  })
  @IsString()
  @Length(1, 100)
  public slug!: string;

  @ApiProperty({
    description: 'An optional description for the tenant',
    example: 'This is a sample tenant for Acme Corporation.',
    required: false,
  })
  @Column({
    type: 'text',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  public description?: string;

  @ApiProperty({
    description: 'The status of the tenant',
    enum: TenantStatus,
    example: TenantStatus.ACTIVE,
  })
  @Column({
    type: 'enum',
    enum: TenantStatus,
    default: TenantStatus.ACTIVE,
  })
  @IsEnum(TenantStatus)
  public status!: TenantStatus;

  @ApiProperty({
    description: 'Configuration object for the tenant',
    example: {},
  })
  @Column({
    type: 'jsonb',
    default: {},
  })
  @IsObject()
  public config!: Record<string, unknown>;

  @ApiProperty({
    description: 'The date and time when the tenant was created',
    example: '2024-01-01T00:00:00Z',
  })
  @CreateDateColumn({
    type: 'timestamptz',
  })
  public created_at!: Date;

  @ApiProperty({
    description: 'The date and time when the tenant was last updated',
    example: '2024-01-01T00:00:00Z',
  })
  @UpdateDateColumn({
    type: 'timestamptz',
  })
  public updated_at!: Date;

  @ApiProperty({
    description: 'The date and time when the tenant was soft deleted',
    example: null,
    required: false,
  })
  @DeleteDateColumn({
    type: 'timestamptz',
    nullable: true,
  })
  public deleted_at?: Date;

  @OneToMany(() => TenantUser, (tenantUser) => tenantUser.tenant)
  public users!: TenantUser[];
}
