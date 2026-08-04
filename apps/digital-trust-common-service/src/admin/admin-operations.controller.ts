import { JwtGuard, ScopeGuard } from '@app/auth';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { API_VERSION } from '../common/constants/api-version.constants';

import { AdminOperationsService } from './admin-operations.service';
import { OperationStatsResponseDto } from './dto/operation-stats-response.dto';

// NOTE: JwtGuard/ScopeGuard are currently stub implementations (see @app/auth
// TODOs) that will validate the app-issued JWT and required admin scope once
// implemented. Applied here per the project's intended admin auth pattern.
@ApiTags('admin')
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
