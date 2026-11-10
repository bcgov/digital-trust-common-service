import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsObject,
  IsString,
  IsUUID,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class OfferDeliveryDto {
  @Expose({ name: 'connection_id' })
  @ApiProperty({
    name: 'connection_id',
    format: 'uuid',
    description: 'Local abstraction connection ID, not a backend connection ID',
  })
  @IsUUID()
  public connectionId!: string;
}

export class OfferCredentialOptionsDto {
  @Expose({ name: 'auto_issue' })
  @ApiPropertyOptional({
    name: 'auto_issue',
    type: Boolean,
    default: true,
    description:
      'Automatically issue after the holder requests the credential. False pauses for a separate issue step, which this API does not yet expose. Exchange records are always retained.',
  })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsBoolean()
  public autoIssue?: boolean;
}

export class OfferCredentialRequestDto {
  @Expose({ name: 'profile_id' })
  @ApiProperty({
    name: 'profile_id',
    description: 'Published issuance profile UUID or name/version',
  })
  @IsDefined()
  @IsString()
  @MinLength(1)
  public profileId!: string;

  @ApiProperty({
    description:
      'RFC 6901 JSON Pointer map of unsigned claim values, using the same paths as profile claim_constraints. Missing values inherit profile defaults. AnonCreds supports flat scalar claims only.',
    type: 'object',
    additionalProperties: true,
    maxProperties: 128,
    example: { '/given_name': 'Alice' },
  })
  @IsDefined()
  @IsObject()
  public claims!: Record<string, unknown>;

  @ApiProperty({ type: OfferDeliveryDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => OfferDeliveryDto)
  public delivery!: OfferDeliveryDto;

  @ApiPropertyOptional({ type: OfferCredentialOptionsDto })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => OfferCredentialOptionsDto)
  public options?: OfferCredentialOptionsDto;
}
