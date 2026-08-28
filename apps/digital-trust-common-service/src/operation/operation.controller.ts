import { ApiJwtAuth, JwtGuard, TenantGuard } from '@app/auth';
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { API_VERSION } from '../common/constants/api-version.constants';

import { OperationResponseDto } from './dto/operation-response.dto';
import { OperationService } from './operation.service';

/**
 * Operation polling (AG-02). No scope is required beyond a tenant-scoped token:
 * reads are authorized by TenantGuard claim-match, not ScopeGuard, so a readonly
 * role can poll the operations its tenant created.
 */
@ApiTags('Operations')
@ApiJwtAuth()
@UseGuards(JwtGuard, TenantGuard)
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@ApiForbiddenResponse({
  description: 'Token tenant claim does not match the requested tenant',
})
@Controller({ path: 'tenants/:tenantId/operations', version: API_VERSION })
export class OperationController {
  public constructor(private readonly operations: OperationService) {}

  @Get(':operationId')
  @ApiOkResponse({
    description: 'Operation status and result',
    type: OperationResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Operation not found' })
  public async findById(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('operationId', ParseUUIDPipe) operationId: string,
  ): Promise<OperationResponseDto> {
    const operation = await this.operations.getForTenant(tenantId, operationId);

    return OperationResponseDto.fromEntity(operation);
  }
}
