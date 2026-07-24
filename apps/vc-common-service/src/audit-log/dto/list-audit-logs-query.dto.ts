import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { AuditAction } from '../audit-log.entity';

export class ListAuditLogsQueryDto {
  @ApiPropertyOptional({ enum: AuditAction })
  @IsOptional()
  @IsEnum(AuditAction)
  public action?: AuditAction;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  public actor_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  public resource_type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public resource_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public operation_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  public since?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  public until?: string;

  @ApiPropertyOptional({
    description: 'Opaque pagination cursor from a previous response',
  })
  @IsOptional()
  @IsString()
  public cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  public limit?: number;
}
