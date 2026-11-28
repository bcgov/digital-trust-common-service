import { ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

import { ConnectionProtocol, ConnectionState } from '../connection.entity';

export class ListConnectionsQueryDto {
  @Expose({ name: 'connector_id' })
  @ApiPropertyOptional({
    name: 'connector_id',
    description: 'Filter connections by connector UUID',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  public connectorId?: string;

  @ApiPropertyOptional({
    enum: ConnectionState,
    description: 'Filter connections by state',
  })
  @IsOptional()
  @IsEnum(ConnectionState)
  public state?: ConnectionState;

  @ApiPropertyOptional({
    enum: ConnectionProtocol,
    description: 'Filter connections by protocol',
  })
  @IsOptional()
  @IsEnum(ConnectionProtocol)
  public protocol?: ConnectionProtocol;

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
