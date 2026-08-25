import {
  ApiJwtAuth,
  JwtGuard,
  RequireScopes,
  ScopeGuard,
  TenantGuard,
  USERS_MANAGE_SCOPE,
} from '@app/auth';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { SkipAutoAudit } from '../audit-log/skip-auto-audit.decorator';
import { API_VERSION } from '../common/constants/api-version.constants';

import { CurrentTenantUser } from './current-tenant-user.decorator';
import { InviteTenantUserDto } from './dto/invite-tenant-user.dto';
import { ListTenantUsersQueryDto } from './dto/list-tenant-users-query.dto';
import { UpdateTenantUserDto } from './dto/update-tenant-user.dto';
import { RequireTenantRoles } from './require-tenant-roles.decorator';
import { TenantMembershipGuard } from './tenant-membership.guard';
import { TenantUser, TenantUserRole } from './tenant-user.entity';
import { PaginatedTenantUsers, TenantUserService } from './tenant-user.service';

@SkipAutoAudit()
@ApiJwtAuth()
@UseGuards(JwtGuard, ScopeGuard, TenantGuard, TenantMembershipGuard)
@RequireScopes(USERS_MANAGE_SCOPE)
@RequireTenantRoles(TenantUserRole.OWNER, TenantUserRole.ADMIN)
@Controller({ path: 'tenants/:tenantId/users', version: API_VERSION })
export class TenantUserController {
  public constructor(private readonly tenantUserService: TenantUserService) {}

  @Post()
  @ApiOperation({
    summary: 'Invite a user to the tenant',
    description:
      'Creates a pending tenant user record for the given email address. The user is linked to a real identity on first login.',
  })
  @ApiCreatedResponse({
    description: 'User invited',
    type: TenantUser,
  })
  @ApiConflictResponse({
    description: 'A tenant user with this email already exists for this tenant',
  })
  @ApiForbiddenResponse({
    description:
      'Caller lacks the required scope, or is not an owner/admin of this tenant',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiBody({
    description: 'Tenant user invite request',
    type: InviteTenantUserDto,
    examples: {
      example1: {
        summary: 'Invite a tenant user',
        value: {
          email: 'john.doe@example.com',
          role: 'admin',
        },
      },
    },
  })
  public async create(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: InviteTenantUserDto,
  ): Promise<TenantUser> {
    return await this.tenantUserService.invite(tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List tenant members' })
  @ApiOkResponse({
    description: 'Paginated user list',
  })
  @ApiForbiddenResponse({
    description:
      'Caller lacks the required scope, or is not an owner/admin of this tenant',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  public async list(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: ListTenantUsersQueryDto,
  ): Promise<PaginatedTenantUsers> {
    return await this.tenantUserService.list(tenantId, {
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  @Patch(':userId')
  @ApiOkResponse({
    description: 'Tenant user updated successfully',
    type: TenantUser,
  })
  @ApiNotFoundResponse({ description: 'Tenant user not found' })
  @ApiConflictResponse({
    description: "Cannot change the role of the tenant's last owner",
  })
  @ApiForbiddenResponse({
    description:
      'Caller lacks the required scope, is not an owner/admin of this tenant, or is attempting to change their own role',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiBody({
    description: 'Tenant user update request',
    type: UpdateTenantUserDto,
    examples: {
      example1: {
        summary: 'Update user role and status',
        value: {
          role: 'member',
          status: 'active',
        },
      },
      example2: {
        summary: 'Update user display name',
        value: {
          displayName: 'Jane Doe',
        },
      },
    },
  })
  public async update(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateTenantUserDto,
    @CurrentTenantUser() callerTenantUser?: TenantUser,
  ): Promise<TenantUser> {
    return await this.tenantUserService.update(
      tenantId,
      userId,
      dto,
      callerTenantUser?.id,
    );
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Tenant user deleted successfully' })
  @ApiNotFoundResponse({ description: 'Tenant user not found' })
  @ApiConflictResponse({
    description: "Cannot remove the tenant's last owner",
  })
  @ApiForbiddenResponse({
    description:
      'Caller lacks the required scope, or is not an owner/admin of this tenant',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  public async delete(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return await this.tenantUserService.delete(tenantId, userId);
  }
}
