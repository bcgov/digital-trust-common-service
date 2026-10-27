import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsEnum,
  Equals,
  IsObject,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { CredentialDefinitionFormat } from '../credential-definition.entity';

export class CredentialDefinitionOptionsBase {
  @ApiProperty({ enum: CredentialDefinitionFormat })
  @IsDefined()
  @IsEnum(CredentialDefinitionFormat)
  public format!: CredentialDefinitionFormat;
}

export class AnonCredsRevocationOptionsDto {
  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  public enabled = true;
}

export class AnonCredsStatusOptionsDto {
  @ApiPropertyOptional({ type: AnonCredsRevocationOptionsDto })
  @IsObject()
  @ValidateNested()
  @Type(() => AnonCredsRevocationOptionsDto)
  public revocation = new AnonCredsRevocationOptionsDto();
}

export class AnonCredsCredentialDefinitionOptionsDto extends CredentialDefinitionOptionsBase {
  @ApiProperty({ enum: [CredentialDefinitionFormat.ANONCREDS] })
  @Equals(CredentialDefinitionFormat.ANONCREDS)
  declare public format: CredentialDefinitionFormat.ANONCREDS;

  @ApiPropertyOptional({ default: 'default', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  public tag = 'default';

  @ApiPropertyOptional({ type: AnonCredsStatusOptionsDto })
  @IsObject()
  @ValidateNested()
  @Type(() => AnonCredsStatusOptionsDto)
  public status = new AnonCredsStatusOptionsDto();
}

export class SdJwtCredentialDefinitionOptionsDto extends CredentialDefinitionOptionsBase {
  @ApiProperty({ enum: [CredentialDefinitionFormat.SD_JWT] })
  @Equals(CredentialDefinitionFormat.SD_JWT)
  declare public format: CredentialDefinitionFormat.SD_JWT;
}

export class MdlCredentialDefinitionOptionsDto extends CredentialDefinitionOptionsBase {
  @ApiProperty({ enum: [CredentialDefinitionFormat.MDL] })
  @Equals(CredentialDefinitionFormat.MDL)
  declare public format: CredentialDefinitionFormat.MDL;
}

export class W3cVcCredentialDefinitionOptionsDto extends CredentialDefinitionOptionsBase {
  @ApiProperty({ enum: [CredentialDefinitionFormat.W3C_VC] })
  @Equals(CredentialDefinitionFormat.W3C_VC)
  declare public format: CredentialDefinitionFormat.W3C_VC;
}
