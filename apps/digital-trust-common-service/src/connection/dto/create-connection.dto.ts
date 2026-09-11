import { Expose } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { ConnectionProtocol } from '../connection.entity';

/**
 * The connector itself is not caller-selected: create() resolves the
 * tenant's connector via AdapterRegistry, and their_label/their_did/
 * external_connection_id/state are populated by the connection.create
 * worker once the connector-side invitation exists, not supplied up front.
 * tenantId itself is a path parameter (POST /tenants/{tenantId}/connections),
 * not a body field.
 */
export class CreateConnectionDto {
  @Expose()
  @IsEnum(ConnectionProtocol)
  public protocol!: ConnectionProtocol;

  @Expose()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  public alias?: string;

  @Expose()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  public label?: string;

  @Expose({ name: 'goal_code' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  public goalCode?: string;

  @Expose({ name: 'multi_use' })
  @IsOptional()
  @IsBoolean()
  public multiUse?: boolean;

  @Expose()
  @IsOptional()
  @IsObject()
  public metadata?: Record<string, unknown>;
}
