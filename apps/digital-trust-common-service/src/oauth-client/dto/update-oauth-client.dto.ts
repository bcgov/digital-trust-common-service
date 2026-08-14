import { OAUTH_CLIENT_ALLOWED_ROLES } from '@app/auth';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateOAuthClientDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  public name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  public scopes?: string[];

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

  /** Null clears the override and returns the client to the server default. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  public refreshTokenTtlSeconds?: number | null;
}
