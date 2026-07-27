import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  IsObject,
} from 'class-validator';

import {
  ConnectorType,
  ConnectionState,
  ConnectionProtocol,
} from '../connection.entity';

export class CreateConnectionDto {
  @IsUUID()
  public tenantId!: string;

  @IsString()
  @MaxLength(255)
  public externalConnectionId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  public theirLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  public theirDid?: string;

  @IsEnum(ConnectionState)
  public state!: ConnectionState;

  @IsEnum(ConnectorType)
  public connectorType!: ConnectorType;

  @IsEnum(ConnectionProtocol)
  public protocol!: ConnectionProtocol;

  @IsOptional()
  @IsObject()
  public metadata?: Record<string, unknown>;
}
