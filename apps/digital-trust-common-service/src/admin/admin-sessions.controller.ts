import {
  ApiJwtAuth,
  CurrentAuth,
  JwtGuard,
  PLATFORM_ADMIN_ROLE,
  RequireRoles,
  ScopeGuard,
} from '@app/auth';
import type { AuthContext } from '@app/auth';
import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { API_VERSION } from '../common/constants/api-version.constants';
import { TenantUserResponseDto } from '../tenant-user/dto/tenant-user-response.dto';
import { TenantUserService } from '../tenant-user/tenant-user.service';

import { AdminSessionsService } from './admin-sessions.service';
import { RevokeSessionsResponseDto } from './dto/revoke-sessions-response.dto';
import { SetPlatformOperatorDto } from './dto/set-platform-operator.dto';

@ApiTags('admin')
@ApiJwtAuth()
@Controller({ path: 'admin/users', version: API_VERSION })
@RequireRoles(PLATFORM_ADMIN_ROLE)
@UseGuards(JwtGuard, ScopeGuard)
export class AdminSessionsController {
  public constructor(
    private readonly adminSessionsService: AdminSessionsService,
    private readonly tenantUserService: TenantUserService,
  ) {}

  @Post(':id/revoke-sessions')
  @ApiOperation({
    summary: 'Force-logout a user',
    description:
      'Deletes every OIDC session, grant, and issued token for the user, immediately terminating any in-flight refresh token chain.',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant user identifier',
    format: 'uuid',
  })
  @ApiCreatedResponse({
    description: 'Sessions revoked',
    type: RevokeSessionsResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Tenant user not found' })
  @ApiForbiddenResponse({ description: 'Caller is not a platform admin' })
  public async revokeSessions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth?: AuthContext,
  ): Promise<RevokeSessionsResponseDto> {
    return this.adminSessionsService.revokeSessions(id, auth?.sub);
  }

  @Patch(':id/platform-operator')
  @ApiOperation({
    summary: 'Flag or unflag a user as a platform operator',
    description:
      "Sets whether this tenant user's OIDC tokens also carry the " +
      'platform-admin role, which bypasses every tenant-scoped role/scope ' +
      'check downstream.',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant user identifier',
    format: 'uuid',
  })
  @ApiOkResponse({
    description: 'Platform operator flag updated',
    type: TenantUserResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Tenant user not found' })
  @ApiForbiddenResponse({ description: 'Caller is not a platform admin' })
  public async setPlatformOperator(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPlatformOperatorDto,
  ): Promise<TenantUserResponseDto> {
    const tenantUser = await this.tenantUserService.setPlatformOperator(
      id,
      dto.isPlatformOperator,
    );

    return TenantUserResponseDto.fromEntity(tenantUser);
  }
}
