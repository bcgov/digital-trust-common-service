import {
  ASSIGNABLE_OAUTH_CLIENT_SCOPES,
  OAUTH_CLIENT_ALLOWED_ROLES,
} from '@app/auth';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateOAuthClientDto {
  @IsString()
  @MaxLength(255)
  public name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn([...ASSIGNABLE_OAUTH_CLIENT_SCOPES], { each: true })
  public scopes!: string[];

  @IsOptional()
  @IsArray()
  @IsIn([...OAUTH_CLIENT_ALLOWED_ROLES], { each: true })
  public roles?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  public redirectUris?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  public grantTypes?: string[];

  @IsOptional()
  @IsInt()
  @IsPositive()
  public refreshTokenTtlSeconds?: number;
}
