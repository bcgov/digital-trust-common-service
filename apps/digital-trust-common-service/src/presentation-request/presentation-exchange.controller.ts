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
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { SkipAutoAudit } from '../audit-log/skip-auto-audit.decorator';
import { API_VERSION } from '../common/constants/api-version.constants';
import { CredentialExchangeActionDto } from '../credential-exchange/credential-exchange-action.dto';
import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import { PresentationExchangeResponseDto } from './presentation-exchange-response.dto';
import { PresentationExchangeService } from './presentation-exchange.service';

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
@ApiUnauthorizedResponse({ description: 'Authentication required' })
@ApiForbiddenResponse({ description: 'credentials:verify scope required' })
@ApiNotFoundResponse({ description: 'Presentation exchange not found' })
@Controller({
  path: 'tenants/:tenantId/presentation-exchanges',
  version: API_VERSION,
})
export class PresentationExchangeController {
  public constructor(private readonly exchanges: PresentationExchangeService) {}

  @Get(':exchangeId')
  @ApiOkResponse({ type: PresentationExchangeResponseDto })
  public async get(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('exchangeId', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<PresentationExchangeResponseDto> {
    return PresentationExchangeResponseDto.fromEntity(
      await this.exchanges.get(tenantId, id, auth),
    );
  }

  @Post(':exchangeId/reconcile')
  @HttpCode(200)
  @ApiBody({
    required: false,
    schema: { type: 'object', additionalProperties: false },
  })
  @ApiOkResponse({ type: PresentationExchangeResponseDto })
  @ApiConflictResponse({
    description: 'Backend correlation is missing or inconsistent',
  })
  public async reconcile(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('exchangeId', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
    @Body() _body: CredentialExchangeActionDto,
  ): Promise<PresentationExchangeResponseDto> {
    return PresentationExchangeResponseDto.fromEntity(
      await this.exchanges.reconcile(tenantId, id, auth),
    );
  }
}
