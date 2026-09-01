import { Expose } from 'class-transformer';
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
  @Expose({ name: 'tenant_id' })
  @IsUUID()
  public tenantId!: string;

  @Expose({ name: 'external_connection_id' })
  @IsString()
  @MaxLength(255)
  public externalConnectionId!: string;

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
  @IsEnum(ConnectionState)
  public state!: ConnectionState;

  @Expose({ name: 'connector_type' })
  @IsEnum(ConnectorType)
  public connectorType!: ConnectorType;

  @Expose()
  @IsEnum(ConnectionProtocol)
  public protocol!: ConnectionProtocol;

  @Expose()
  @IsOptional()
  @IsObject()
  public metadata?: Record<string, unknown>;
}
