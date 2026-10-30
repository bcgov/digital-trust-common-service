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
  HttpCode,
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
  ApiConflictResponse,
  ApiNotFoundResponse,
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

/** Issuer-side offers with explicit delivery and inferred credential format. */
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
  @ApiBody({
    type: OfferCredentialRequestDto,
    examples: {
      anoncreds: {
        summary: 'Offer unsigned subject claims over DIDComm v1',
        value: {
          credential_definition_id: '123e4567-e89b-12d3-a456-426614174001',
          credential: { credentialSubject: { given_name: 'Alice' } },
          delivery: {
            protocol: 'didcomm-v1',
            connection_id: '123e4567-e89b-12d3-a456-426614174002',
          },
          options: { auto_issue: true },
        },
      },
    },
  })
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
      'delivery or subject claims are invalid, profile/' +
      'credential_definition_id resolution failed, or attribute validation failed',
  })
  @ApiConflictResponse({
    description:
      'Holder handshake is incomplete, or connection binding is unavailable or inconsistent',
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

  @Post('offer/:operationId/reconcile')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiParam({ name: 'operationId', format: 'uuid' })
  @ApiOkResponse({
    description:
      'Offer reconciled from an authenticated backend read; never resends',
    type: OperationResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Offer operation not found for this tenant',
  })
  @ApiConflictResponse({
    description:
      'Exchange or wallet correlation is unavailable or inconsistent',
  })
  public async reconcile(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('operationId', ParseUUIDPipe) operationId: string,
  ): Promise<OperationResponseDto> {
    return OperationResponseDto.fromEntity(
      await this.credentialOffer.reconcile(tenantId, operationId),
    );
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
