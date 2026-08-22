import { ApiJwtAuth, JwtGuard } from '@app/auth';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { API_VERSION } from '../common/constants/api-version.constants';

import { RoleListResponseDto } from './dto/role-scope.dto';
import { RoleScopeService } from './role-scope.service';

/**
 * Platform default role→scope mappings. Tenant-specific mappings live at
 * `/tenants/{tenantId}/roles`, since this route carries no tenant.
 */
@ApiTags('admin')
@ApiJwtAuth()
@Controller({ path: 'roles', version: API_VERSION })
@UseGuards(JwtGuard)
export class RoleController {
  public constructor(private readonly roleScopes: RoleScopeService) {}

  @Get()
  @ApiOperation({
    summary: 'List roles with their default scope mappings',
    description:
      'Returns the platform default mapping. Tenants that have customised a role see their own values at GET /tenants/{tenantId}/roles.',
  })
  @ApiOkResponse({
    description: 'Roles and their scopes',
    type: RoleListResponseDto,
  })
  public async listRoles(): Promise<RoleListResponseDto> {
    return { data: await this.roleScopes.getDefaultRoleMapping() };
  }
}
