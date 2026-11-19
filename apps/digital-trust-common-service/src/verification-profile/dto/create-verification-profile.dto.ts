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
  MinLength,
} from 'class-validator';

import { VerificationProfileProtocolHint } from '../verification-profile.entity';

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
