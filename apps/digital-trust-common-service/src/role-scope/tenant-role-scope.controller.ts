import {
  ApiJwtAuth,
  CurrentAuth,
  JwtGuard,
  RequireScopes,
  ScopeGuard,
  TENANT_SUPERUSER_SCOPE,
  TenantGuard,
} from '@app/auth';
import type { AuthContext } from '@app/auth';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { SkipAutoAudit } from '../audit-log/skip-auto-audit.decorator';
import { API_VERSION } from '../common/constants/api-version.constants';

import {
  RoleListResponseDto,
  RoleParamDto,
  RoleScopesResponseDto,
  UpdateRoleScopesDto,
} from './dto/role-scope.dto';
import { RoleScopeService } from './role-scope.service';

/**
 * Per-tenant role→scope overrides (AU-07 #40).
 *
 * Writes require `tenants:admin` rather than `users:manage`. `admin` holds
 * `users:manage`, so guarding with it would let an admin grant themselves
 * any scope — the exact escalation the hierarchy exists to prevent.
 *
 * `@SkipAutoAudit()` is deliberate, not an opt-out of auditing.
 * `AuditAutoInterceptor` resolves the resource id from `params.id` only, so
 * it silently drops routes keyed on `:role` (#192). `RoleScopeService`
 * writes its own entry inside the write transaction, which also captures the
 * real actor and the revoked-session count.
 */
@ApiTags('tenant-settings')
@ApiJwtAuth()
@Controller({ path: 'tenants/:tenantId', version: API_VERSION })
@UseGuards(JwtGuard, ScopeGuard, TenantGuard)
export class TenantRoleScopeController {
  public constructor(private readonly roleScopes: RoleScopeService) {}

  @Get('roles')
  @ApiOperation({
    summary: "List a tenant's effective role scope mappings",
    description:
      'Each role reports whether its scopes come from the platform default or a tenant override.',
  })
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiOkResponse({
    description: 'Effective roles and their scopes',
    type: RoleListResponseDto,
  })
  public async listTenantRoles(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ): Promise<RoleListResponseDto> {
    return { data: await this.roleScopes.getTenantRoleMapping(tenantId) };
  }

  @Patch('roles/:role/scopes')
  @SkipAutoAudit()
  @RequireScopes(TENANT_SUPERUSER_SCOPE)
  @ApiOperation({
    summary: 'Customize role scope mappings for a tenant',
    description:
      'Replaces the scopes for this role in this tenant. The body is the complete list, not a delta.\n\n' +
      'Role hierarchy is enforced across the whole mapping: no role may hold a scope the role above it lacks. ' +
      'The `owner` role cannot be changed, and `tenants:admin` cannot be granted to any other role.\n\n' +
      'Removing a scope logs out every active user holding this role in the tenant. The `scope` claim is fixed ' +
      'by the OIDC grant created at login and is not refreshed when a refresh token rotates, so revoking the ' +
      'sessions is the only way to make the change take effect before the tokens expire. Adding scopes has no ' +
      'such effect and takes effect at the next login.',
  })
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiParam({ name: 'role', enum: ['admin', 'member', 'readonly'] })
  @ApiOkResponse({
    description: 'Role scopes updated',
    type: RoleScopesResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Unknown scope, hierarchy violation, immutable role, or non-assignable scope',
  })
  @ApiForbiddenResponse({ description: 'Caller lacks tenants:admin' })
  public async updateRoleScopes(
    @Param() params: RoleParamDto,
    @Body() body: UpdateRoleScopesDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<RoleScopesResponseDto> {
    return this.roleScopes.replaceRoleScopes({
      tenantId: params.tenantId,
      role: params.role,
      scopes: body.scopes,
      actorId: auth.sub,
      actorScopes: auth.scopes,
      actorRoles: auth.roles,
      actorTokenType: auth.tokenType,
    });
  }

  @Delete('roles/:role/scopes')
  @SkipAutoAudit()
  @RequireScopes(TENANT_SUPERUSER_SCOPE)
  @ApiOperation({
    summary: "Reset a role to the platform's default scopes",
    description:
      'Removes the tenant override so the role inherits the platform default again. Idempotent.\n\n' +
      'A reset that narrows the role logs out its active users, for the same reason a narrowing PATCH does.',
  })
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiParam({ name: 'role', enum: ['admin', 'member', 'readonly'] })
  @ApiOkResponse({
    description: 'Override removed',
    type: RoleScopesResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Immutable role or resulting hierarchy violation',
  })
  @ApiForbiddenResponse({ description: 'Caller lacks tenants:admin' })
  public async resetRoleScopes(
    @Param() params: RoleParamDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<RoleScopesResponseDto> {
    return this.roleScopes.resetRoleScopes({
      tenantId: params.tenantId,
      role: params.role,
      actorId: auth.sub,
      actorScopes: auth.scopes,
      actorRoles: auth.roles,
      actorTokenType: auth.tokenType,
    });
  }
}
