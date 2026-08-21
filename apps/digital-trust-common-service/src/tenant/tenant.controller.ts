import {
  ApiJwtAuth,
  CurrentAuth,
  JwtGuard,
  PLATFORM_ADMIN_ROLE,
  RequireRoles,
  RequireScopes,
  ScopeGuard,
  TENANT_SUPERUSER_SCOPE,
} from '@app/auth';
import type { AuthContext } from '@app/auth';
import { TenantAccessDeniedException } from '@app/auth/exceptions/tenant-access-denied.exception';
import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { SkipAutoAudit } from '../audit-log/skip-auto-audit.decorator';
import { API_VERSION } from '../common/constants/api-version.constants';

import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { Tenant } from './tenant.entity';
import { TenantService } from './tenant.service';

@SkipAutoAudit()
@ApiTags('tenant')
@ApiJwtAuth()
@UseGuards(JwtGuard, ScopeGuard)
@Controller({ path: 'tenants', version: API_VERSION })
export class TenantController {
  public constructor(private readonly tenantService: TenantService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a tenant',
    description:
      'Creates a tenant. Requests from platform-admin users are activated immediately; self-service requests are created with a pending_approval status until reviewed.',
  })
  @ApiCreatedResponse({
    description: 'Tenant created successfully',
    type: Tenant,
  })
  @ApiConflictResponse({ description: 'Tenant slug already exists' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiBody({
    description: 'Tenant creation request',
    type: CreateTenantDto,
    examples: {
      example1: {
        summary: 'Create a new tenant',
        value: {
          name: 'Acme Corporation',
          slug: 'acme-corp',
          description: 'A sample tenant organization',
          config: { theme: 'dark', timezone: 'UTC' },
        },
      },
    },
  })
  public async create(
    @Body() dto: CreateTenantDto,
    @CurrentAuth() auth?: AuthContext,
  ): Promise<Tenant> {
    return this.tenantService.create(dto, auth);
  }

  @Patch(':id')
  @RequireScopes(TENANT_SUPERUSER_SCOPE)
  @ApiOperation({
    summary: 'Update a tenant',
    description:
      'Updates a tenant record. Requires a valid JWT and the tenant superuser scope, and the caller must match the tenant being modified unless the caller is a platform admin.',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant identifier',
    format: 'uuid',
  })
  @ApiOkResponse({
    description: 'Tenant updated successfully',
    type: Tenant,
  })
  @ApiNotFoundResponse({ description: 'Tenant not found' })
  @ApiForbiddenResponse({
    description: 'Caller is not allowed to access or modify the target tenant',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiBody({
    description: 'Tenant update request',
    type: UpdateTenantDto,
    examples: {
      example1: {
        summary: 'Update tenant description and config',
        value: {
          description: 'Updated description',
          config: { theme: 'light', timezone: 'EST' },
        },
      },
    },
  })
  public async update(
    @Body() dto: UpdateTenantDto,
    @Param('id') id: string,
    @CurrentAuth() auth?: AuthContext,
  ): Promise<Tenant> {
    this.assertTenantAccess(auth, id);
    return this.tenantService.update(id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List accessible tenants',
    description:
      'Returns all tenants for platform-admins, or the current tenant for tenant-scoped users.',
  })
  @ApiOkResponse({
    description: 'List of all tenants',
    type: [Tenant],
  })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  public async findAll(@CurrentAuth() auth?: AuthContext): Promise<Tenant[]> {
    if (!auth) {
      return [];
    }

    if (auth.roles.includes(PLATFORM_ADMIN_ROLE)) {
      return this.tenantService.findAll();
    }

    if (!auth.tenantId) {
      return [];
    }

    const tenant = await this.tenantService.findById(auth.tenantId);
    return tenant ? [tenant] : [];
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Fetch a tenant by id',
    description:
      'Returns a single tenant if the caller is a platform admin or belongs to the same tenant.',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant identifier',
    format: 'uuid',
  })
  @ApiOkResponse({
    description: 'Tenant found',
    type: Tenant,
  })
  @ApiNotFoundResponse({ description: 'Tenant not found' })
  @ApiForbiddenResponse({
    description: 'Caller is not allowed to access the target tenant',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  public async findById(
    @Param('id') id: string,
    @CurrentAuth() auth?: AuthContext,
  ): Promise<Tenant | null> {
    const tenant = await this.tenantService.findById(id);

    if (!tenant) {
      return null;
    }

    this.assertTenantAccess(auth, tenant.id);
    return tenant;
  }

  @Get('slug/:slug')
  @ApiOperation({
    summary: 'Fetch a tenant by slug',
    description:
      'Returns a tenant by slug when the caller is a platform admin or belongs to that tenant.',
  })
  @ApiParam({
    name: 'slug',
    description: 'Tenant slug',
    example: 'acme-corp',
  })
  @ApiOkResponse({
    description: 'Tenant found by slug',
    type: Tenant,
  })
  @ApiNotFoundResponse({ description: 'Tenant not found' })
  @ApiForbiddenResponse({
    description: 'Caller is not allowed to access the target tenant',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  public async findBySlug(
    @Param('slug') slug: string,
    @CurrentAuth() auth?: AuthContext,
  ): Promise<Tenant | null> {
    const tenant = await this.tenantService.findBySlug(slug);

    if (!tenant) {
      return null;
    }

    this.assertTenantAccess(auth, tenant.id);
    return tenant;
  }

  @Delete(':id')
  @RequireRoles(PLATFORM_ADMIN_ROLE)
  @ApiOperation({
    summary: 'Delete a tenant',
    description: 'Soft deletes a tenant. Requires platform-admin privileges.',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant identifier',
    format: 'uuid',
  })
  @ApiOkResponse({ description: 'Tenant deleted successfully' })
  @ApiNotFoundResponse({ description: 'Tenant not found' })
  @ApiForbiddenResponse({ description: 'Caller is not a platform admin' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  public async delete(@Param('id') id: string): Promise<void> {
    return this.tenantService.delete(id);
  }

  @Post(':id/restore')
  @RequireRoles(PLATFORM_ADMIN_ROLE)
  @ApiOperation({
    summary: 'Restore a soft-deleted tenant',
    description:
      'Restores a previously soft-deleted tenant. Requires platform-admin privileges.',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant identifier',
    format: 'uuid',
  })
  @ApiOkResponse({ description: 'Tenant restored successfully' })
  @ApiNotFoundResponse({ description: 'Tenant not found' })
  @ApiForbiddenResponse({ description: 'Caller is not a platform admin' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  public async restore(@Param('id') id: string): Promise<void> {
    return this.tenantService.restore(id);
  }

  private assertTenantAccess(
    auth: AuthContext | undefined,
    tenantId: string,
  ): void {
    if (!auth) {
      throw new TenantAccessDeniedException(
        'Authenticated request context is missing',
        {
          requiredTenantId: tenantId,
          tokenTenantId: null,
        },
      );
    }

    if (auth.roles.includes(PLATFORM_ADMIN_ROLE)) {
      return;
    }

    if (!auth.tenantId) {
      throw new TenantAccessDeniedException(
        'Token is missing a tenant_id claim',
        {
          requiredTenantId: tenantId,
          tokenTenantId: null,
        },
      );
    }

    if (auth.tenantId !== tenantId) {
      throw new TenantAccessDeniedException(
        'Token tenant_id does not match the requested tenant',
        {
          requiredTenantId: tenantId,
          tokenTenantId: auth.tenantId,
        },
      );
    }
  }
}
