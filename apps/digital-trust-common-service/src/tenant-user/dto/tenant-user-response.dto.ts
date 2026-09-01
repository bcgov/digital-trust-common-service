import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

import {
  TenantUser,
  TenantUserRole,
  TenantUserStatus,
} from '../tenant-user.entity';

/**
 * Deliberately a whitelist rather than the TenantUser entity: `externalUserId`
 * and `updatedAt` are internal bookkeeping and are not part of the contract.
 */
export class TenantUserResponseDto {
  @ApiProperty({
    description: 'The unique identifier of the tenant user',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public id!: string;

  @Expose({ name: 'tenant_id' })
  @ApiProperty({
    name: 'tenant_id',
    description: 'The tenant ID this user belongs to',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public tenantId!: string;

  @ApiProperty({
    description: 'The email address of the user',
    example: 'user@example.com',
  })
  public email!: string;

  @Expose({ name: 'display_name' })
  @ApiProperty({
    name: 'display_name',
    description: 'The display name of the user',
    example: 'John Doe',
    required: false,
    nullable: true,
  })
  public displayName?: string;

  @ApiProperty({
    description: 'The role of the user within the tenant',
    enum: TenantUserRole,
    example: TenantUserRole.MEMBER,
  })
  public role!: TenantUserRole;

  @ApiProperty({
    description: 'The status of the user',
    enum: TenantUserStatus,
    example: TenantUserStatus.ACTIVE,
  })
  public status!: TenantUserStatus;

  @Expose({ name: 'created_at' })
  @ApiProperty({
    name: 'created_at',
    description: 'The date and time when the tenant user was created',
    example: '2024-01-01T00:00:00Z',
  })
  public createdAt!: Date;

  public static fromEntity(tenantUser: TenantUser): TenantUserResponseDto {
    const dto = new TenantUserResponseDto();
    dto.id = tenantUser.id;
    dto.tenantId = tenantUser.tenantId;
    dto.email = tenantUser.email;
    dto.displayName = tenantUser.displayName;
    dto.role = tenantUser.role;
    dto.status = tenantUser.status;
    dto.createdAt = tenantUser.createdAt;
    return dto;
  }
}

export class TenantUsersPaginationDto {
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
  }): TenantUsersPaginationDto {
    const dto = new TenantUsersPaginationDto();
    dto.nextCursor = pagination.next_cursor;
    dto.hasMore = pagination.has_more;
    return dto;
  }
}

export class PaginatedTenantUsersResponseDto {
  @ApiProperty({ type: [TenantUserResponseDto] })
  public data!: TenantUserResponseDto[];

  @ApiProperty({ type: TenantUsersPaginationDto })
  public pagination!: TenantUsersPaginationDto;
}
