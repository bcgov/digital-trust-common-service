import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsISO8601, IsOptional } from 'class-validator';

import { AuditAction } from '../audit-log.entity';

export class ExportAuditLogsQueryDto {
  @ApiPropertyOptional({ enum: AuditAction })
  @IsOptional()
  @IsEnum(AuditAction)
  public action?: AuditAction;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  public since?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  public until?: string;
}
