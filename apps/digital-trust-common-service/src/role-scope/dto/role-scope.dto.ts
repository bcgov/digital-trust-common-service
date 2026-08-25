import { ROLE_HIERARCHY } from '@app/auth';
import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsString, IsUUID } from 'class-validator';

/**
 * Path parameters for the tenant role-scope routes.
 *
 * The role is validated here rather than in the repository: an unrecognised
 * value would otherwise reach the `$1::tenant_user_role` cast and surface as
 * a Postgres error, turning a client mistake into a 500.
 *
 * `tenantId` is declared even though `TenantGuard` also checks it, because
 * the global ValidationPipe runs with `forbidNonWhitelisted` and would
 * otherwise reject the undeclared path parameter.
 */
export class RoleParamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  public tenantId!: string;

  @ApiProperty({
    description: 'Tenant user role',
    enum: ROLE_HIERARCHY,
  })
  @IsIn(ROLE_HIERARCHY)
  public role!: string;
}

export class UpdateRoleScopesDto {
  @ApiProperty({
    description: 'Complete replacement scope list for this role in this tenant',
    type: [String],
    example: ['credentials:offer', 'connections:manage'],
  })
  @IsArray()
  @ArrayMaxSize(64)
  @IsString({ each: true })
  public scopes!: string[];
}

export class ScopeCatalogItemDto {
  @ApiProperty({ example: 'credentials:offer' })
  public name!: string;

  @ApiProperty({ example: 'Issue credential offers.' })
  public description!: string;

  @ApiProperty({
    description: '1 is the tenant superuser scope; higher numbers are narrower',
    example: 2,
  })
  public level!: number;
}

export class ScopeListResponseDto {
  @ApiProperty({ type: [ScopeCatalogItemDto] })
  public data!: ScopeCatalogItemDto[];
}

export class RoleMappingItemDto {
  @ApiProperty({ example: 'admin' })
  public name!: string;

  @ApiProperty({ type: [String] })
  public scopes!: string[];

  @ApiProperty({
    description:
      '`override` when the tenant has customised this role, `default` when it inherits the platform mapping',
    enum: ['default', 'override'],
  })
  public source!: string;
}

export class RoleListResponseDto {
  @ApiProperty({ type: [RoleMappingItemDto] })
  public data!: RoleMappingItemDto[];
}

export class RoleScopesResponseDto {
  @ApiProperty({ example: 'admin' })
  public role!: string;

  @ApiProperty({ type: [String] })
  public scopes!: string[];

  @ApiProperty({ enum: ['default', 'override'] })
  public source!: string;

  @ApiProperty({
    description:
      'OIDC records deleted because the change removed scopes. Zero when the change only widened the role.',
    example: 0,
  })
  public revokedRecordCount!: number;
}
