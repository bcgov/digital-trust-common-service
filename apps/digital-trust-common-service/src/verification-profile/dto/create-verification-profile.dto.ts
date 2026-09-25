import { Expose, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { VerificationProfileProtocolHint } from '../verification-profile.entity';

import { VerificationPredicateDto } from './verification-predicate.dto';

export class CreateVerificationProfileDto {
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

  @Expose({ name: 'issuance_profile_id' })
  @IsUUID()
  public issuanceProfileId!: string;

  @Expose({ name: 'presentation_definition' })
  @IsObject()
  public presentationDefinition!: Record<string, unknown>;

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
