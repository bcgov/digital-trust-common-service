import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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

import { AuditAction } from '../audit-log.entity';

export class ListAuditLogsQueryDto {
  @ApiPropertyOptional({ enum: AuditAction })
  @IsOptional()
  @IsEnum(AuditAction)
  public action?: AuditAction;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  public actorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  public resourceType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public resourceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public operationId?: string;

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
