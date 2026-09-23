import { Expose, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { VerificationProfileProtocolHint } from '../verification-profile.entity';

import { VerificationPredicateDto } from './verification-predicate.dto';

/**
 * Narrower than CreateVerificationProfileDto by design: name, version, and
 * issuance_profile_id are immutable once set (mirrors
 * UpdateIssuanceProfileDto's pattern of excluding identity fields from
 * updates).
 */
export class UpdateVerificationProfileDto {
  @Expose()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  public description?: string;

  @Expose({ name: 'presentation_definition' })
  @IsOptional()
  @IsObject()
  public presentationDefinition?: Record<string, unknown>;

  @Expose()
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VerificationPredicateDto)
  public predicates?: VerificationPredicateDto[];

  @Expose()
  @IsOptional()
  @IsObject()
  public metadata?: Record<string, unknown>;

  @Expose({ name: 'public' })
  @IsOptional()
  @IsBoolean()
  public isPublic?: boolean;

  @Expose({ name: 'protocol_hint' })
  @IsOptional()
  @IsEnum(VerificationProfileProtocolHint)
  public protocolHint?: VerificationProfileProtocolHint;
}
