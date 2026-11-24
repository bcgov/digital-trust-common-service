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
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { API_VERSION } from '../common/constants/api-version.constants';
import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import { PresentationExchangeResponseDto } from './dto/presentation-exchange-response.dto';
import { PresentationExchangeService } from './presentation-exchange.service';

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
@ApiForbiddenResponse({
  description: 'Requires credentials:verify and tenant access',
})
@Controller({
  path: 'tenants/:tenantId/presentation-exchanges',
  version: API_VERSION,
})
export class PresentationExchangeController {
  public constructor(private readonly exchanges: PresentationExchangeService) {}

  @Get(':id')
  @ApiOkResponse({ type: PresentationExchangeResponseDto })
  @ApiNotFoundResponse({ description: 'Presentation exchange not found' })
  public async get(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<PresentationExchangeResponseDto> {
    return PresentationExchangeResponseDto.fromEntity(
      await this.exchanges.get(tenantId, id, auth),
    );
  }

  @Post(':id/reconcile')
  @HttpCode(200)
  @ApiOkResponse({ type: PresentationExchangeResponseDto })
  @ApiNotFoundResponse({ description: 'Presentation exchange not found' })
  public async reconcile(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<PresentationExchangeResponseDto> {
    return PresentationExchangeResponseDto.fromEntity(
      await this.exchanges.reconcile(tenantId, id, auth),
    );
  }
}
