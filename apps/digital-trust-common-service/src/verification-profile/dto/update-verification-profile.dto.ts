import { ApiProperty } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
  ValidateIf,
} from 'class-validator';

import { VerificationProfileProtocolHint } from '../verification-profile.entity';

import { VerificationDeliveryDto } from './verification-delivery.dto';

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
  @ApiProperty({
    name: 'presentation_definition_id',
    format: 'uuid',
    required: false,
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID()
  public presentationDefinitionId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => VerificationDeliveryDto)
  @ApiProperty({ type: VerificationDeliveryDto, required: false })
  public delivery?: VerificationDeliveryDto;

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
  @IsIn([
    VerificationProfileProtocolHint.DIDCOMM,
    VerificationProfileProtocolHint.AUTO,
  ])
  public protocolHint?: VerificationProfileProtocolHint;
}
