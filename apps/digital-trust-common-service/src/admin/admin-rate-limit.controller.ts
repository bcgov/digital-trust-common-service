import type { AuthContext } from '@app/auth';
import {
  ApiJwtAuth,
  CurrentAuth,
  JwtGuard,
  PLATFORM_ADMIN_ROLE,
  RequireRoles,
  ScopeGuard,
} from '@app/auth';
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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

import { AdminRateLimitService } from './admin-rate-limit.service';
import { RateLimitResetResponseDto } from './dto/rate-limit-reset-response.dto';
import { RateLimitStatusResponseDto } from './dto/rate-limit-status-response.dto';

@ApiTags('admin')
@ApiJwtAuth()
@Controller({ path: 'admin/rate-limits', version: API_VERSION })
@RequireRoles(PLATFORM_ADMIN_ROLE)
@UseGuards(JwtGuard, ScopeGuard)
export class AdminRateLimitController {
  public constructor(
    private readonly adminRateLimitService: AdminRateLimitService,
  ) {}

  @Get(':tenantId')
  @ApiOperation({
    summary: "View a tenant's current rate-limit status",
    description:
      'Resolved tier, limit, and per-route hit counts within the current sliding window.',
  })
  @ApiParam({
    name: 'tenantId',
    description: 'Tenant identifier',
    format: 'uuid',
  })
  @ApiOkResponse({
    description: 'Current rate-limit status for the tenant',
    type: RateLimitStatusResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Tenant not found' })
  @ApiForbiddenResponse({ description: 'Caller is not a platform admin' })
  public async getStatus(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ): Promise<RateLimitStatusResponseDto> {
    return this.adminRateLimitService.getStatus(tenantId);
  }

  @Post(':tenantId/reset')
  @ApiOperation({
    summary: "Reset a tenant's rate limit",
    description:
      'Deletes every recorded hit for the tenant, clearing it back to zero for every route.',
  })
  @ApiParam({
    name: 'tenantId',
    description: 'Tenant identifier',
    format: 'uuid',
  })
  @ApiCreatedResponse({
    description: 'Rate limit reset',
    type: RateLimitResetResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Tenant not found' })
  @ApiForbiddenResponse({ description: 'Caller is not a platform admin' })
  public async reset(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @CurrentAuth() auth?: AuthContext,
  ): Promise<RateLimitResetResponseDto> {
    return this.adminRateLimitService.reset(tenantId, auth?.sub);
  }
}
