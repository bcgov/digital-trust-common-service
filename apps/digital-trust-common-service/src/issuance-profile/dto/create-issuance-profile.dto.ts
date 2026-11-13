import { ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import type { ProfileClaims } from '../claims-schema';

import { IssuanceDeliveryDto } from './issuance-delivery.dto';

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

  @Expose()
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Required claim names and allowed-value overlays.',
  })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsObject()
  public claims?: ProfileClaims;

  @Expose()
  @IsOptional()
  @IsObject()
  public display?: Record<string, unknown>;

  @Expose()
  @IsOptional()
  @IsObject()
  public metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ type: IssuanceDeliveryDto })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => IssuanceDeliveryDto)
  public delivery?: IssuanceDeliveryDto;
}
