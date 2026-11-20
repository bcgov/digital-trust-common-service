import {
  ApiJwtAuth,
  CurrentAuth,
  JwtGuard,
  RequireScopes,
  ScopeGuard,
  TenantGuard,
  WEBHOOKS_MANAGE_SCOPE,
  type AuthContext,
} from '@app/auth';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { API_VERSION } from '../common/constants/api-version.constants';
import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import { CreateWebhookRegistrationResponseDto } from './dto/create-webhook-registration-response.dto';
import { CreateWebhookRegistrationDto } from './dto/create-webhook-registration.dto';
import { WebhookRegistrationResponseDto } from './dto/webhook-registration-response.dto';
import { WebhookRegistrationService } from './webhook-registration.service';

@ApiTags('Webhooks')
@ApiJwtAuth()
@RequireScopes(WEBHOOKS_MANAGE_SCOPE)
@UseGuards(
  JwtGuard,
  ScopeGuard,
  TenantGuard,
  TenantStatusGuard,
  TenantTierRateLimitGuard,
)
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@ApiForbiddenResponse({
  description: 'Token lacks webhooks:manage, or tenant claim does not match',
})
@Controller({ path: 'tenants/:tenantId/webhooks', version: API_VERSION })
export class WebhookRegistrationController {
  public constructor(
    private readonly registrations: WebhookRegistrationService,
  ) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Register a tenant webhook',
    description:
      'Registers a public HTTPS endpoint. The server-generated HMAC signing secret is returned once and cannot be retrieved again.',
  })
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiBody({ type: CreateWebhookRegistrationDto })
  @ApiCreatedResponse({
    description: 'Webhook registered; signing secret is included only once.',
    type: CreateWebhookRegistrationResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Endpoint URL is invalid, unresolved, or not publicly routable.',
  })
  public async create(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateWebhookRegistrationDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<CreateWebhookRegistrationResponseDto> {
    const { registration, signingSecret } = await this.registrations.create(
      tenantId,
      dto,
      auth,
    );
    return CreateWebhookRegistrationResponseDto.from(
      registration,
      signingSecret,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List tenant webhook registrations' })
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiOkResponse({
    description: 'Webhook registrations; signing secrets are never included.',
    type: [WebhookRegistrationResponseDto],
  })
  public async findByTenant(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<WebhookRegistrationResponseDto[]> {
    const registrations = await this.registrations.findByTenant(tenantId, auth);
    return registrations.map((registration) =>
      WebhookRegistrationResponseDto.fromEntity(registration),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a tenant webhook registration' })
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Webhook registration deleted.' })
  @ApiNotFoundResponse({ description: 'Webhook registration not found.' })
  public async delete(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    await this.registrations.delete(tenantId, id, auth);
  }
}
