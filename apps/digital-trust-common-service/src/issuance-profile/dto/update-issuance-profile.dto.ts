import { ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import type { ClaimConstraints } from '../claim-constraints';

import { IssuanceDeliveryDto } from './issuance-delivery.dto';

/**
 * Narrower than CreateIssuanceProfileDto by design: name, version,
 * credential_definition_id are
 * immutable once set (mirrors UpdateCredentialDefinitionDto's pattern of
 * excluding identity/type fields from updates).
 */
export class UpdateIssuanceProfileDto {
  @Expose()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  public description?: string;

  @Expose({ name: 'claim_constraints' })
  @ApiPropertyOptional({
    name: 'claim_constraints',
    type: 'object',
    additionalProperties: { type: 'object' },
    description:
      'Replacement JSON Pointer map of claim constraints and defaults',
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

  @ApiPropertyOptional({ type: IssuanceDeliveryDto })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => IssuanceDeliveryDto)
  public delivery?: IssuanceDeliveryDto;
}
