import {
  ApiJwtAuth,
  CurrentAuth,
  JwtGuard,
  RequireScopes,
  ScopeGuard,
  TenantGuard,
  type AuthContext,
} from '@app/auth';
import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { SkipAutoAudit } from '../audit-log/skip-auto-audit.decorator';
import { API_VERSION } from '../common/constants/api-version.constants';
import { OperationResponseDto } from '../operation/dto/operation-response.dto';
import { OperationState } from '../operation/operation.entity';
import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import { CreatePresentationRequestDto } from './dto/create-presentation-request.dto';
import { PresentationRequestService } from './presentation-request.service';

@SkipAutoAudit()
@ApiTags('Presentations')
@ApiJwtAuth()
@UseGuards(
  JwtGuard,
  ScopeGuard,
  TenantGuard,
  TenantStatusGuard,
  TenantTierRateLimitGuard,
)
@RequireScopes('credentials:verify')
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@ApiForbiddenResponse({
  description: 'Requires credentials:verify and tenant access',
})
@Controller({
  path: 'tenants/:tenantId/presentation-requests',
  version: API_VERSION,
})
export class PresentationExecutionController {
  public constructor(private readonly requests: PresentationRequestService) {}

  @Post()
  @ApiBody({ type: CreatePresentationRequestDto })
  @ApiAcceptedResponse({
    description: 'Profile snapshotted and proof request submitted',
    type: OperationResponseDto,
  })
  @ApiOkResponse({
    description: 'Terminal operation',
    type: OperationResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Profile, connection, or connector is not usable',
  })
  public async create(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreatePresentationRequestDto,
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OperationResponseDto> {
    const operation = await this.requests.create(tenantId, dto, auth);
    res.status(
      [OperationState.PENDING, OperationState.PROCESSING].includes(
        operation.state,
      )
        ? HttpStatus.ACCEPTED
        : HttpStatus.OK,
    );
    return OperationResponseDto.fromEntity(operation);
  }

  @Get(':id')
  @ApiOkResponse({ type: OperationResponseDto })
  @ApiNotFoundResponse({ description: 'Presentation request not found' })
  public async get(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<OperationResponseDto> {
    return OperationResponseDto.fromEntity(
      await this.requests.get(tenantId, id, auth),
    );
  }
}
