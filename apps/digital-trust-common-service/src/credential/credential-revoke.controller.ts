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
  ApiBadRequestResponse,
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

import { CredentialRevokeService } from './credential-revoke.service';

/**
 * Issuer-side credential revocation (CA-07). `:credentialId` is the
 * persisted Credential record id — see `docs/openapi.yaml`, not the
 * Operation id used by CA-05's accept/reject routes.
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
@RequireScopes('credentials:revoke')
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@ApiForbiddenResponse({
  description: 'Token lacks credentials:revoke, or tenant claim does not match',
})
@Controller({ path: 'tenants/:tenantId/credentials', version: API_VERSION })
export class CredentialRevokeController {
  public constructor(
    private readonly credentialRevoke: CredentialRevokeService,
  ) {}

  @Post(':credentialId/revoke')
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiParam({ name: 'credentialId', format: 'uuid' })
  @ApiOkResponse({
    description: 'Revocation completed synchronously',
    type: OperationResponseDto,
  })
  @ApiAcceptedResponse({
    description: 'Revocation in progress (async ledger write)',
    type: OperationResponseDto,
  })
  @ApiBadRequestResponse({
    description: "Credential's format does not support revocation",
  })
  @ApiNotFoundResponse({ description: 'Credential not found' })
  public async revoke(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('credentialId', ParseUUIDPipe) credentialId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OperationResponseDto> {
    const operation = await this.credentialRevoke.revoke(
      tenantId,
      credentialId,
    );

    res.status(this.resolveStatus(operation.state));

    return OperationResponseDto.fromEntity(operation);
  }

  /**
   * Pending/processing means the revocation is still an in-flight async
   * ledger write -> 202. Any terminal state (completed or failed) means the
   * request resolved synchronously, so the caller gets the final envelope in
   * this response.
   */
  private resolveStatus(state: OperationState): HttpStatus {
    return state === OperationState.PENDING ||
      state === OperationState.PROCESSING
      ? HttpStatus.ACCEPTED
      : HttpStatus.OK;
  }
}
