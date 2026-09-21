import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';

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
}
