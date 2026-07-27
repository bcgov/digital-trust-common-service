import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { ConnectionProtocol, ConnectionState } from '../connection.entity';

export class UpdateConnectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  public theirLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  public theirDid?: string;

  @IsOptional()
  @IsEnum(ConnectionState)
  public state?: ConnectionState;

  @IsOptional()
  @IsEnum(ConnectionProtocol)
  public protocol?: ConnectionProtocol;

  @IsOptional()
  @IsObject()
  public metadata?: Record<string, unknown>;
}
