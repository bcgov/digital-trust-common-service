import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { VerificationProfileProtocolHint } from '../verification-profile.entity';

/**
 * Narrower than CreateVerificationProfileDto by design: name and version
 * are immutable once set (mirrors UpdateIssuanceProfileDto's pattern of
 * excluding identity fields from updates).
 */
export class UpdateVerificationProfileDto {
  @Expose()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  public description?: string;

  @Expose({ name: 'presentation_definition_id' })
  @ApiProperty({ name: 'presentation_definition_id', format: 'uuid' })
  @IsUUID()
  public presentationDefinitionId!: string;

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
