import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  IsDefined,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import type { ClaimConstraints } from '../claim-constraints';

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

  @Expose({ name: 'claim_constraints' })
  @ApiPropertyOptional({
    name: 'claim_constraints',
    type: 'object',
    additionalProperties: { type: 'object' },
    description:
      'RFC 6901 pointer map using the same paths as offer claims; constraints supplement credential definition validation',
  })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsObject()
  public claimConstraints?: ClaimConstraints;

  @Expose()
  @IsOptional()
  @IsObject()
  public display?: Record<string, unknown>;

  @Expose()
  @IsOptional()
  @IsObject()
  public metadata?: Record<string, unknown>;

  @IsDefined()
  @ApiProperty({ type: IssuanceDeliveryDto })
  @IsObject()
  @ValidateNested()
  @Type(() => IssuanceDeliveryDto)
  public delivery!: IssuanceDeliveryDto;
}
