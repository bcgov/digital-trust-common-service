import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { OperationState } from '../operation.entity';

export class ListOperationItemsQueryDto {
  @ApiPropertyOptional({
    enum: OperationState,
    description: 'Filter operations by state',
  })
  @IsOptional()
  @IsEnum(OperationState)
  public state?: OperationState;

  @ApiPropertyOptional({
    description:
      'Opaque cursor from a previous page; reuse unchanged with the same filters. Ordered by created_at DESC, then id DESC.',
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
