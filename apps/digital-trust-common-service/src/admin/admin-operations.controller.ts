import { JwtGuard, ScopeGuard, ApiAppJwtAuth } from '@app/auth';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { API_VERSION } from '../common/constants/api-version.constants';

import { AdminOperationsService } from './admin-operations.service';
import { OperationStatsResponseDto } from './dto/operation-stats-response.dto';

// JwtGuard validates app-issued Bearer JWTs (AU-03). ScopeGuard remains a stub
// until scope enforcement lands; valid tokens therefore still receive 501 here.
@ApiTags('admin')
@ApiAppJwtAuth()
@Controller({ path: 'admin/operations', version: API_VERSION })
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
  public async getStats(): Promise<OperationStatsResponseDto> {
    return this.adminOperationsService.getStats();
  }
}
