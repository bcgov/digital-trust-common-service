import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

import { Tenant, TenantStatus } from '../tenant.entity';

export class TenantResponseDto {
  @ApiProperty({
    description: 'The unique identifier of the tenant',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public id!: string;

  @ApiProperty({
    description: 'The name of the tenant',
    example: 'Acme Corporation',
  })
  public name!: string;

  @ApiProperty({
    description: 'A unique slug for the tenant',
    example: 'acme-corp',
  })
  public slug!: string;

  @ApiProperty({
    description: 'An optional description for the tenant',
    example: 'This is a sample tenant for Acme Corporation.',
    required: false,
    nullable: true,
  })
  public description?: string | null;

  @ApiProperty({
    description: 'The status of the tenant',
    enum: TenantStatus,
    example: TenantStatus.ACTIVE,
  })
  public status!: TenantStatus;

  @ApiProperty({
    description: 'Configuration object for the tenant',
    example: {},
  })
  public config!: Record<string, unknown>;

  @Expose({ name: 'created_at' })
  @ApiProperty({
    name: 'created_at',
    description: 'The date and time when the tenant was created',
    example: '2024-01-01T00:00:00Z',
  })
  public createdAt!: Date;

  @Expose({ name: 'updated_at' })
  @ApiProperty({
    name: 'updated_at',
    description: 'The date and time when the tenant was last updated',
    example: '2024-01-01T00:00:00Z',
  })
  public updatedAt!: Date;

  @Expose({ name: 'deactivated_at' })
  @ApiProperty({
    name: 'deactivated_at',
    description:
      'The date and time when the tenant was deactivated. Null unless the tenant is currently deactivated; cleared on reactivation. Used to measure the data retention window.',
    example: null,
    required: false,
    nullable: true,
  })
  public deactivatedAt?: Date | null;

  public static fromEntity(tenant: Tenant): TenantResponseDto {
    const dto = new TenantResponseDto();
    dto.id = tenant.id;
    dto.name = tenant.name;
    dto.slug = tenant.slug;
    dto.description = tenant.description;
    dto.status = tenant.status;
    dto.config = tenant.config;
    dto.createdAt = tenant.createdAt;
    dto.updatedAt = tenant.updatedAt;
    dto.deactivatedAt = tenant.deactivatedAt;
    return dto;
  }
}

export class TenantsPaginationDto {
  @Expose({ name: 'next_cursor' })
  @ApiProperty({
    name: 'next_cursor',
    description: 'Cursor to fetch the next page, or null if there is none',
    example: null,
    nullable: true,
  })
  public nextCursor!: string | null;

  @Expose({ name: 'has_more' })
  @ApiProperty({
    name: 'has_more',
    description: 'Whether more results are available beyond this page',
    example: false,
  })
  public hasMore!: boolean;

  public static from(pagination: {
    next_cursor: string | null;
    has_more: boolean;
  }): TenantsPaginationDto {
    const dto = new TenantsPaginationDto();
    dto.nextCursor = pagination.next_cursor;
    dto.hasMore = pagination.has_more;
    return dto;
  }
}

export class PaginatedTenantsResponseDto {
  @ApiProperty({ type: [TenantResponseDto] })
  public data!: TenantResponseDto[];

  @ApiProperty({ type: TenantsPaginationDto })
  public pagination!: TenantsPaginationDto;
}
