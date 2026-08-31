import { Exclude, Expose } from 'class-transformer';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { ConnectionProtocol, ConnectionState } from '../connection.entity';

@Exclude()
export class UpdateConnectionDto {
  @Expose({ name: 'their_label' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  public theirLabel?: string;

  @Expose({ name: 'their_did' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  public theirDid?: string;

  @Expose()
  @IsOptional()
  @IsEnum(ConnectionState)
  public state?: ConnectionState;

  @Expose()
  @IsOptional()
  @IsEnum(ConnectionProtocol)
  public protocol?: ConnectionProtocol;

  @Expose()
  @IsOptional()
  @IsObject()
  public metadata?: Record<string, unknown>;
}
