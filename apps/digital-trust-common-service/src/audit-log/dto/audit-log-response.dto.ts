import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

import { AuditAction, AuditActorType, AuditLog } from '../audit-log.entity';

export class AuditLogResponseDto {
  @ApiProperty({
    description: 'The unique identifier of the audit log entry',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public id!: string;

  @Expose({ name: 'tenant_id' })
  @ApiProperty({
    name: 'tenant_id',
    description: 'The tenant ID this audit entry belongs to',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  public tenantId!: string;

  @Expose({ name: 'actor_id' })
  @ApiProperty({
    name: 'actor_id',
    description: 'Actor identifier (user ID, client ID, or system)',
    example: 'user-123',
  })
  public actorId!: string;

  @Expose({ name: 'actor_type' })
  @ApiProperty({
    name: 'actor_type',
    description: 'Actor type',
    enum: AuditActorType,
    example: AuditActorType.USER,
  })
  public actorType!: AuditActorType;

  @ApiProperty({
    description: 'Audited action',
    enum: AuditAction,
    example: AuditAction.ISSUE,
  })
  public action!: AuditAction;

  @Expose({ name: 'resource_type' })
  @ApiProperty({
    name: 'resource_type',
    description: 'Resource type',
    example: 'credential',
  })
  public resourceType!: string;

  @Expose({ name: 'resource_id' })
  @ApiProperty({
    name: 'resource_id',
    description: 'Resource ID',
    example: '123e4567-e89b-12d3-a456-426614174002',
  })
  public resourceId!: string;

  @Expose({ name: 'operation_id' })
  @ApiProperty({
    name: 'operation_id',
    description: 'Linked operation ID, when applicable',
    required: false,
    nullable: true,
  })
  public operationId?: string | null;

  @ApiProperty({
    description: 'Additional context metadata',
    example: {},
  })
  public metadata!: Record<string, unknown>;

  @Expose({ name: 'ip_address' })
  @ApiProperty({
    name: 'ip_address',
    description: 'Client IP address',
    required: false,
    nullable: true,
  })
  public ipAddress?: string | null;

  @Expose({ name: 'created_at' })
  @ApiProperty({
    name: 'created_at',
    description: 'When the audit entry was created',
  })
  public createdAt!: Date;

  public static fromEntity(entry: AuditLog): AuditLogResponseDto {
    const dto = new AuditLogResponseDto();
    dto.id = entry.id;
    dto.tenantId = entry.tenantId;
    dto.actorId = entry.actorId;
    dto.actorType = entry.actorType;
    dto.action = entry.action;
    dto.resourceType = entry.resourceType;
    dto.resourceId = entry.resourceId;
    dto.operationId = entry.operationId;
    dto.metadata = entry.metadata;
    dto.ipAddress = entry.ipAddress;
    dto.createdAt = entry.createdAt;
    return dto;
  }
}

export class AuditLogsPaginationDto {
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

  public static from(
    nextCursor: string | null,
    hasMore: boolean,
  ): AuditLogsPaginationDto {
    const dto = new AuditLogsPaginationDto();
    dto.nextCursor = nextCursor;
    dto.hasMore = hasMore;
    return dto;
  }
}

export class PaginatedAuditLogsResponseDto {
  @ApiProperty({ type: [AuditLogResponseDto] })
  public data!: AuditLogResponseDto[];

  @ApiProperty({ type: AuditLogsPaginationDto })
  public pagination!: AuditLogsPaginationDto;
}
