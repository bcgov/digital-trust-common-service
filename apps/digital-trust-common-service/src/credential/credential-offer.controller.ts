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

import { CredentialOfferService } from './credential-offer.service';
import { OfferCredentialRequestDto } from './dto/offer-credential-request.dto';

/**
 * Issuer-side credential offer submission. MVP only supports DIDComm
 * delivery (`connection_id` required) — see `docs/openapi.yaml`.
 */
@SkipAutoAudit()
@ApiTags('Credentials')
@ApiJwtAuth()
@UseGuards(
  JwtGuard,
  ScopeGuard,
  TenantGuard,
  TenantStatusGuard,
  TenantTierRateLimitGuard,
)
@RequireScopes('credentials:offer')
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@ApiForbiddenResponse({
  description: 'Token lacks credentials:offer, or tenant claim does not match',
})
@Controller({ path: 'tenants/:tenantId/credentials', version: API_VERSION })
export class CredentialOfferController {
  public constructor(
    private readonly credentialOffer: CredentialOfferService,
  ) {}

  @Post('offer')
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiBody({ type: OfferCredentialRequestDto })
  @ApiOkResponse({
    description: 'Credential offer completed synchronously',
    type: OperationResponseDto,
  })
  @ApiAcceptedResponse({
    description: 'Credential offer submitted (DIDComm, async)',
    type: OperationResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'connection_id is missing (OID4VCI not yet supported), profile/' +
      'credential_definition_id resolution failed, or attribute validation failed',
  })
  public async offer(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: OfferCredentialRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OperationResponseDto> {
    const operation = await this.credentialOffer.offer(tenantId, dto);

    res.status(this.resolveStatus(operation.state));

    return OperationResponseDto.fromEntity(operation);
  }

  /**
   * Pending/processing means the agent has not confirmed the offer yet ->
   * 202. Any terminal state (completed or failed) means the request
   * resolved synchronously, so the caller gets the final envelope here.
   */
  private resolveStatus(state: OperationState): HttpStatus {
    return state === OperationState.PENDING ||
      state === OperationState.PROCESSING
      ? HttpStatus.ACCEPTED
      : HttpStatus.OK;
  }
}
