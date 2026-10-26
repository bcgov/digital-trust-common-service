import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class AnonCredsRevocationOptionsDto {
  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  public enabled = true;
}

export class AnonCredsCredentialDefinitionOptionsDto {
  @ApiPropertyOptional({ default: 'default', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  public tag = 'default';

  @ApiPropertyOptional({ type: AnonCredsRevocationOptionsDto })
  @ValidateNested()
  @Type(() => AnonCredsRevocationOptionsDto)
  public revocation = new AnonCredsRevocationOptionsDto();
}

export class SdJwtCredentialDefinitionOptionsDto {}

export class MdlCredentialDefinitionOptionsDto {}

export class W3cVcCredentialDefinitionOptionsDto {}
