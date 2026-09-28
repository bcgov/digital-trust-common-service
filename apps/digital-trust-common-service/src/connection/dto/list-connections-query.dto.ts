import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { ConnectionState } from '../connection.entity';

export class ListConnectionsQueryDto {
  @ApiPropertyOptional({
    enum: ConnectionState,
    description: 'Filter connections by state',
  })
  @IsOptional()
  @IsEnum(ConnectionState)
  public state?: ConnectionState;

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
