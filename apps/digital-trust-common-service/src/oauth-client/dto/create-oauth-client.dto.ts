import {
  ASSIGNABLE_OAUTH_CLIENT_SCOPES,
  OAUTH_CLIENT_ALLOWED_ROLES,
} from '@app/auth';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  Matches,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Body for `POST /tenants/:tenantId/clients`.
 *
 * Tenant association is the path `tenantId` (TenantGuard), not a body field,
 * so the body cannot disagree with the route the caller is authorized for.
 * `createdBy` is taken from the authenticated user `sub` in the service —
 * callers cannot spoof the audit actor.
 */
export class CreateOAuthClientDto {
  @ApiPropertyOptional({
    name: 'client_id',
    description:
      'Optional unique client ID. Must start with dtcs_; omitted IDs are generated automatically.',
    pattern: '^dtcs_[a-z0-9][a-z0-9_-]{0,249}$',
    maxLength: 255,
    example: 'dtcs_issuance-service',
  })
  @Expose({ name: 'client_id' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^dtcs_[a-z0-9][a-z0-9_-]{0,249}$/)
  public clientId?: string;

  @Expose()
  @IsString()
  @MaxLength(255)
  public name!: string;

  @Expose()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn([...ASSIGNABLE_OAUTH_CLIENT_SCOPES], { each: true })
  public scopes!: string[];

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

  @Expose({ name: 'refresh_token_ttl_seconds' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  public refreshTokenTtlSeconds?: number;
}
