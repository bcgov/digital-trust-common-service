import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsDefined,
  IsObject,
  IsString,
  IsUUID,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class OfferedCredentialDto {
  @ApiProperty({
    description:
      'Unsigned subject claims. AnonCreds currently supports flat scalar values only; this input does not imply W3C credential output.',
    type: 'object',
    additionalProperties: true,
  })
  @IsDefined()
  @IsObject()
  public credentialSubject!: Record<string, unknown>;
}

export class OfferDeliveryDto {
  @ApiProperty({ enum: ['didcomm-v1'] })
  @Equals('didcomm-v1', {
    message: 'Only didcomm-v1 delivery is currently supported',
  })
  public protocol!: 'didcomm-v1';

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
  @ApiPropertyOptional({
    name: 'profile_id',
    description:
      'Profile UUID or name/version; excludes credential_definition_id',
  })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  public profileId?: string;

  @Expose({ name: 'credential_definition_id' })
  @ApiPropertyOptional({
    name: 'credential_definition_id',
    format: 'uuid',
    description: 'Local definition ID; format is inferred; excludes profile_id',
  })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsUUID()
  public credentialDefinitionId?: string;

  @ApiProperty({ type: OfferedCredentialDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => OfferedCredentialDto)
  public credential!: OfferedCredentialDto;

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
