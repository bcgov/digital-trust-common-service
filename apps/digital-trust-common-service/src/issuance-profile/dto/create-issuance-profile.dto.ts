import { Expose } from 'class-transformer';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

import { IssuanceProfileProtocolHint } from '../issuance-profile.entity';

export class CreateIssuanceProfileDto {
  @Expose()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  public name!: string;

  @Expose()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  public version!: string;

  @Expose()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  public description?: string;

  @Expose({ name: 'credential_definition_id' })
  @IsUUID()
  public credentialDefinitionId!: string;

  @Expose({ name: 'connector_id' })
  @IsOptional()
  @IsUUID()
  public connectorId?: string;

  @Expose({ name: 'attribute_schema' })
  @IsObject()
  public attributeSchema!: Record<string, unknown>;

  @Expose()
  @IsOptional()
  @IsObject()
  public defaults?: Record<string, unknown>;

  @Expose()
  @IsOptional()
  @IsObject()
  public display?: Record<string, unknown>;

  @Expose()
  @IsOptional()
  @IsObject()
  public metadata?: Record<string, unknown>;

  @Expose({ name: 'protocol_hint' })
  @IsOptional()
  @IsEnum(IssuanceProfileProtocolHint)
  public protocolHint?: IssuanceProfileProtocolHint;
}
