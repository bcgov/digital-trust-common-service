import { Expose } from 'class-transformer';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { IssuanceProfileProtocolHint } from '../issuance-profile.entity';

/**
 * Narrower than CreateIssuanceProfileDto by design: name, version,
 * credential_definition_id, connector_id, and attribute_schema are
 * immutable once set (mirrors UpdateCredentialDefinitionDto's pattern of
 * excluding identity/type fields from updates).
 */
export class UpdateIssuanceProfileDto {
  @Expose()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  public description?: string;

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
