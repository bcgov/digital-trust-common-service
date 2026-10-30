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
  Get,
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
  ApiBody,
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiServiceUnavailableResponse,
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

import { CredentialExchangeActionDto } from './credential-exchange-action.dto';
import { CredentialExchangeResponseDto } from './credential-exchange-response.dto';
import { CredentialExchangeService } from './credential-exchange.service';

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
@ApiParam({ name: 'tenantId', format: 'uuid' })
@ApiParam({ name: 'exchangeId', format: 'uuid' })
@ApiNotFoundResponse({ description: 'Exchange not found for this tenant' })
@ApiUnauthorizedResponse({ description: 'Authentication required' })
@ApiForbiddenResponse({ description: 'credentials:offer scope required' })
@Controller({
  path: 'tenants/:tenantId/credential-exchanges',
  version: API_VERSION,
})
export class CredentialExchangeController {
  public constructor(private readonly exchanges: CredentialExchangeService) {}

  @Get(':exchangeId')
  @ApiOkResponse({ type: CredentialExchangeResponseDto })
  public async get(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('exchangeId', ParseUUIDPipe) id: string,
  ): Promise<CredentialExchangeResponseDto> {
    return CredentialExchangeResponseDto.fromEntity(
      await this.exchanges.get(tenantId, id),
    );
  }

  @Post(':exchangeId/reconcile')
  @ApiBody({
    required: false,
    schema: { type: 'object', additionalProperties: false },
  })
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CredentialExchangeResponseDto })
  @ApiConflictResponse({
    description:
      'Backend exchange/holder is missing or correlation is inconsistent',
  })
  public async reconcile(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('exchangeId', ParseUUIDPipe) id: string,
    @Body() _body: CredentialExchangeActionDto,
  ): Promise<CredentialExchangeResponseDto> {
    return CredentialExchangeResponseDto.fromEntity(
      await this.exchanges.reconcile(tenantId, id),
    );
  }

  @Post(':exchangeId/issue')
  @ApiBody({
    required: false,
    schema: { type: 'object', additionalProperties: false },
  })
  @ApiOkResponse({
    type: OperationResponseDto,
    description: 'Existing or completed issue action',
  })
  @ApiAcceptedResponse({
    type: OperationResponseDto,
    description: 'Issuance in progress',
  })
  @ApiConflictResponse({
    description:
      'Backend exchange/holder missing, invalid role/state, or attempted submission without retained operation',
  })
  @ApiBadRequestResponse({
    description:
      'Backend definitively rejected issuance; failed attempt may be retried',
  })
  @ApiBadGatewayResponse({
    description:
      'Token acquisition failed before submission; failed attempt may be retried',
  })
  @ApiServiceUnavailableResponse({
    description:
      'Submission outcome uncertain; reconcile instead of retrying issuance',
  })
  public async issue(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('exchangeId', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
    @Body() _body: CredentialExchangeActionDto,
  ): Promise<OperationResponseDto> {
    const operation = await this.exchanges.issue(tenantId, id);
    res.status(
      [OperationState.PENDING, OperationState.PROCESSING].includes(
        operation.state,
      )
        ? HttpStatus.ACCEPTED
        : HttpStatus.OK,
    );
    return OperationResponseDto.fromEntity(operation);
  }
}
