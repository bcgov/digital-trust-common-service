import {
  ApiJwtAuth,
  JwtGuard,
  RequireScopes,
  ScopeGuard,
  TenantGuard,
} from '@app/auth';
import {
  Body,
  Controller,
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
  ApiOkResponse,
  ApiParam,
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

import { RequestPresentationDto } from './dto/request-presentation.dto';
import { PresentationRequestService } from './presentation-request.service';

/**
 * Backs POST /tenants/:tenantId/presentations/request — see
 * `docs/openapi.yaml`'s `requestPresentation` operation.
 */
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
  description: 'Token lacks credentials:verify, or tenant claim does not match',
})
@Controller({ path: 'tenants/:tenantId/presentations', version: API_VERSION })
export class PresentationRequestController {
  public constructor(
    private readonly presentationRequestService: PresentationRequestService,
  ) {}

  @Post('request')
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiBody({ type: RequestPresentationDto })
  @ApiOkResponse({
    description: 'Presentation request resolved synchronously',
    type: OperationResponseDto,
  })
  @ApiAcceptedResponse({
    description: 'Presentation request sent (DIDComm, async)',
    type: OperationResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Both or neither of verification_profile_id/presentation_definition ' +
      'were provided, the profile is not published, presentation_definition ' +
      'is structurally invalid, connection_id is missing (MVP is DIDComm-only), ' +
      'or connection_id does not belong to this tenant.',
  })
  public async request(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: RequestPresentationDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OperationResponseDto> {
    const operation = await this.presentationRequestService.requestPresentation(
      tenantId,
      dto,
    );

    res.status(this.resolveStatus(operation.state));

    return OperationResponseDto.fromEntity(operation);
  }

  /**
   * Pending/processing means the DIDComm proof request was sent and is
   * awaiting the holder's response -> 202, matching openapi's documented
   * "Presentation request sent (DIDComm, async)" response. Any terminal
   * state (completed or failed) means the request resolved synchronously,
   * so the caller gets the final envelope directly.
   */
  private resolveStatus(state: OperationState): HttpStatus {
    return state === OperationState.PENDING ||
      state === OperationState.PROCESSING
      ? HttpStatus.ACCEPTED
      : HttpStatus.OK;
  }
}
