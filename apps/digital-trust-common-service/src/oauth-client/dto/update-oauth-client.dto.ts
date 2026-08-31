import {
  ASSIGNABLE_OAUTH_CLIENT_SCOPES,
  OAUTH_CLIENT_ALLOWED_ROLES,
} from '@app/auth';
import { Exclude, Expose } from 'class-transformer';
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

@Exclude()
export class UpdateOAuthClientDto {
  @Expose()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  public name?: string;

  @Expose()
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn([...ASSIGNABLE_OAUTH_CLIENT_SCOPES], { each: true })
  public scopes?: string[];

  @Expose()
  @IsOptional()
  @IsArray()
  @IsIn([...OAUTH_CLIENT_ALLOWED_ROLES], { each: true })
  public roles?: string[];

  @Expose({ name: 'redirect_uris' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  public redirectUris?: string[];

  @Expose({ name: 'grant_types' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  public grantTypes?: string[];

  /** Null clears the override and returns the client to the server default. */
  @Expose({ name: 'refresh_token_ttl_seconds' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  public refreshTokenTtlSeconds?: number | null;
}
