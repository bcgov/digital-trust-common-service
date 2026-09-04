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
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
} from '@nestjs/swagger';

import { API_VERSION } from '../common/constants/api-version.constants';
import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import { CreateOAuthClientResponseDto } from './dto/create-oauth-client-response.dto';
import { CreateOAuthClientDto } from './dto/create-oauth-client.dto';
import { OAuthClientResponseDto } from './dto/oauth-client-response.dto';
import { UpdateOAuthClientDto } from './dto/update-oauth-client.dto';
import { OAuthClient } from './oauth-client.entity';
import { OAuthClientService } from './oauth-client.service';

@ApiTags('Clients')
@ApiJwtAuth()
@RequireScopes('clients:manage')
@UseGuards(
  JwtGuard,
  ScopeGuard,
  TenantGuard,
  TenantStatusGuard,
  TenantTierRateLimitGuard,
)
@Controller({ path: 'tenants/:tenantId/clients', version: API_VERSION })
export class OAuthClientController {
  public constructor(private readonly oauthClientService: OAuthClientService) {}

  @Post()
  @ApiOperation({
    summary: 'Register an API client (OAuth2 client_credentials)',
    description:
      'Creates a new OAuth2 client for service-to-service authentication. Tenant is taken from the path; created_by is recorded from the authenticated user. The client_secret is returned ONCE and cannot be retrieved again.',
  })
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiCreatedResponse({
    description: 'OAuth client created successfully',
    type: CreateOAuthClientResponseDto,
  })
  @ApiForbiddenResponse({
    description:
      'Token lacks clients:manage, or requested scopes exceed the caller grants',
  })
  @ApiBody({
    description: 'OAuth client creation request',
    type: CreateOAuthClientDto,
    examples: {
      example1: {
        summary: 'Create an OAuth client',
        value: {
          name: 'Mobile App',
          scopes: ['credentials:offer', 'credentials:verify'],
          redirect_uris: ['https://app.example.com/callback'],
          grant_types: ['client_credentials'],
        },
      },
    },
  })
  public async createClient(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateOAuthClientDto,
    @CurrentAuth() auth?: AuthContext,
  ): Promise<CreateOAuthClientResponseDto> {
    const { client, clientSecret } = await this.oauthClientService.createClient(
      tenantId,
      dto,
      auth,
    );
    return CreateOAuthClientResponseDto.from(client, clientSecret);
  }

  @Get()
  @ApiOperation({ summary: 'List API clients' })
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiOkResponse({
    description:
      'List of OAuth clients for the specified tenant (secrets are never included)',
    type: [OAuthClientResponseDto],
  })
  public async findByTenant(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ): Promise<OAuthClientResponseDto[]> {
    const clients = await this.oauthClientService.findByTenant(tenantId);
    return clients.map((client) => this.toResponseDto(client));
  }

  @Patch(':clientId')
  @ApiOperation({ summary: 'Update an API client' })
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiParam({
    name: 'clientId',
    description: 'Public OAuth client_id (not the row UUID)',
  })
  @ApiOkResponse({
    description: 'OAuth client updated successfully',
    type: OAuthClientResponseDto,
  })
  @ApiNotFoundResponse({ description: 'OAuth client not found' })
  @ApiBody({
    description: 'OAuth client update request',
    type: UpdateOAuthClientDto,
    examples: {
      example1: {
        summary: 'Update OAuth client name and scopes',
        value: {
          name: 'Updated Mobile App',
          scopes: [
            'credentials:offer',
            'credentials:verify',
            'connections:manage',
          ],
        },
      },
      example2: {
        summary:
          'Grant platform-admin on a client_credentials-only machine client (platform-admin caller)',
        value: {
          roles: ['platform-admin'],
          grant_types: ['client_credentials'],
        },
      },
      example3: {
        summary: 'Grant a tenant-scoped role (tenant admin)',
        value: {
          roles: ['admin'],
          grant_types: ['client_credentials'],
        },
      },
      example4: {
        summary: 'Update redirect URIs',
        value: {
          redirect_uris: ['https://app.updated.com/callback'],
        },
      },
    },
  })
  public async update(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('clientId') clientId: string,
    @Body() dto: UpdateOAuthClientDto,
    @CurrentAuth() auth?: AuthContext,
  ): Promise<OAuthClientResponseDto> {
    const client = await this.oauthClientService.update(
      tenantId,
      clientId,
      dto,
      auth,
    );
    return this.toResponseDto(client);
  }

  @Delete(':clientId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke an API client' })
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiParam({
    name: 'clientId',
    description: 'Public OAuth client_id (not the row UUID)',
  })
  @ApiNoContentResponse({ description: 'OAuth client revoked successfully' })
  @ApiNotFoundResponse({ description: 'OAuth client not found' })
  public async revokeClient(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('clientId') clientId: string,
  ): Promise<void> {
    return await this.oauthClientService.revokeClient(tenantId, clientId);
  }

  @Post(':clientId/rotate-secret')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate client secret',
    description:
      'Generates a new secret. The old secret is immediately invalidated. The new secret is returned ONCE.',
  })
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiParam({
    name: 'clientId',
    description: 'Public OAuth client_id (not the row UUID)',
  })
  @ApiOkResponse({
    description: 'New secret generated',
    type: CreateOAuthClientResponseDto,
  })
  @ApiNotFoundResponse({ description: 'OAuth client not found' })
  public async rotateSecret(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('clientId') clientId: string,
  ): Promise<CreateOAuthClientResponseDto> {
    const { client, clientSecret } = await this.oauthClientService.rotateSecret(
      tenantId,
      clientId,
    );
    return CreateOAuthClientResponseDto.from(client, clientSecret);
  }

  private toResponseDto(client: OAuthClient): OAuthClientResponseDto {
    return OAuthClientResponseDto.fromEntity(client);
  }
}
