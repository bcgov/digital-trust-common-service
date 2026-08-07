import {
  ApiAppJwtAuth,
  JwtGuard,
  PLATFORM_ADMIN_ROLE,
  RequireRoles,
  ScopeGuard,
} from '@app/auth';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { API_VERSION } from '../common/constants/api-version.constants';

import { AdminOperationsService } from './admin-operations.service';
import { OperationStatsResponseDto } from './dto/operation-stats-response.dto';

@ApiTags('admin')
@ApiAppJwtAuth()
@Controller({ path: 'admin/operations', version: API_VERSION })
@RequireRoles(PLATFORM_ADMIN_ROLE)
@UseGuards(JwtGuard, ScopeGuard)
export class AdminOperationsController {
  public constructor(
    private readonly adminOperationsService: AdminOperationsService,
  ) {}

  @Get('stats')
  @ApiOkResponse({
    description:
      'Operation counts by state and the oldest pending operation, across all tenants',
    type: OperationStatsResponseDto,
  })
  @ApiForbiddenResponse({
    description: 'Token is valid but lacks the platform-admin role',
  })
  public async getStats(): Promise<OperationStatsResponseDto> {
    return this.adminOperationsService.getStats();
  }
}
