import {
  ApiJwtAuth,
  JwtGuard,
  RequireScopes,
  ScopeGuard,
  TenantGuard,
} from '@app/auth';
import {
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
  ApiForbiddenResponse,
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

import { CredentialActionService } from './credential-action.service';

/**
 * Holder-side accept/reject for a credential offer (CA-05). `:exchangeId` is
 * the Operation UUID returned by `POST /credentials/offer` — see
 * `docs/openapi.yaml`, not the persisted Credential record id.
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
@RequireScopes('credentials:hold')
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@ApiForbiddenResponse({
  description: 'Token lacks credentials:hold, or tenant claim does not match',
})
@Controller({ path: 'tenants/:tenantId/credentials', version: API_VERSION })
export class CredentialActionController {
  public constructor(
    private readonly credentialActions: CredentialActionService,
  ) {}

  @Post(':exchangeId/accept')
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiParam({ name: 'exchangeId', format: 'uuid' })
  @ApiOkResponse({
    description: 'Credential accepted (synchronous confirmation)',
    type: OperationResponseDto,
  })
  @ApiAcceptedResponse({
    description: 'Accept request submitted (async)',
    type: OperationResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Credential offer not found' })
  public async accept(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('exchangeId', ParseUUIDPipe) exchangeId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OperationResponseDto> {
    const operation = await this.credentialActions.accept(tenantId, exchangeId);

    res.status(this.resolveStatus(operation.state));

    return OperationResponseDto.fromEntity(operation);
  }

  @Post(':exchangeId/reject')
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiParam({ name: 'exchangeId', format: 'uuid' })
  @ApiOkResponse({
    description: 'Credential rejected',
    type: OperationResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Credential offer not found' })
  public async reject(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('exchangeId', ParseUUIDPipe) exchangeId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OperationResponseDto> {
    const operation = await this.credentialActions.reject(tenantId, exchangeId);

    res.status(this.resolveStatus(operation.state));

    return OperationResponseDto.fromEntity(operation);
  }

  /**
   * Pending/processing means the agent has not confirmed yet -> 202. Any
   * terminal state (completed or failed) means the request resolved
   * synchronously, so the caller gets the final envelope in this response.
   */
  private resolveStatus(state: OperationState): HttpStatus {
    return state === OperationState.PENDING ||
      state === OperationState.PROCESSING
      ? HttpStatus.ACCEPTED
      : HttpStatus.OK;
  }
}
