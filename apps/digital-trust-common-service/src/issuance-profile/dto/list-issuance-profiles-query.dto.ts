import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { CredentialDefinitionFormat } from '../../credential-definition/credential-definition.entity';
import { IssuanceProfileStatus } from '../issuance-profile.entity';

export class ListIssuanceProfilesQueryDto {
  @ApiPropertyOptional({ enum: IssuanceProfileStatus })
  @IsOptional()
  @IsEnum(IssuanceProfileStatus)
  public status?: IssuanceProfileStatus;

  @ApiPropertyOptional({ enum: CredentialDefinitionFormat })
  @IsOptional()
  @IsEnum(CredentialDefinitionFormat)
  public format?: CredentialDefinitionFormat;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  public name?: string;

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
