import { ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

import { VerificationProfileStatus } from '../verification-profile.entity';

/** Coerces the `true`/`false` query string into a boolean; anything else is left as-is for @IsBoolean() to reject. */
function toBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

export class ListVerificationProfilesQueryDto {
  @ApiPropertyOptional({ enum: VerificationProfileStatus })
  @IsOptional()
  @IsEnum(VerificationProfileStatus)
  public status?: VerificationProfileStatus;

  @Expose({ name: 'issuance_profile_id' })
  @ApiPropertyOptional({
    name: 'issuance_profile_id',
    description: 'Filter by the linked issuance profile',
  })
  @IsOptional()
  @IsUUID()
  public issuanceProfileId?: string;

  @Expose({ name: 'public' })
  @ApiPropertyOptional({
    name: 'public',
    description: 'Filter by public discoverability',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  public isPublic?: boolean;

  @ApiPropertyOptional({
    description: 'Opaque pagination cursor from a previous response',
  })
  @IsOptional()
  @IsString()
  public cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  public limit?: number;
}
