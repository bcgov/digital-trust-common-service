import {
  ApiJwtAuth,
  CurrentAuth,
  JwtGuard,
  RequireScopes,
  ScopeGuard,
  TENANT_SUPERUSER_SCOPE,
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
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { API_VERSION } from '../common/constants/api-version.constants';
import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import { ConnectorCredential } from './connector-credential.entity';
import { ConnectorCredentialService } from './connector-credential.service';
import { ConnectorCredentialResponseDto } from './dto/connector-credential-response.dto';
import { CreateConnectorCredentialDto } from './dto/create-connector-credential.dto';
import { UpdateConnectorCredentialDto } from './dto/update-connector-credential.dto';

@ApiJwtAuth()
@UseGuards(
  JwtGuard,
  ScopeGuard,
  TenantGuard,
  TenantStatusGuard,
  TenantTierRateLimitGuard,
)
@RequireScopes(TENANT_SUPERUSER_SCOPE)
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@ApiForbiddenResponse({
  description: 'Token lacks tenants:admin, or tenant claim does not match',
})
@Controller({ path: 'tenants/:tenantId/connectors', version: API_VERSION })
export class ConnectorCredentialController {
  public constructor(
    private readonly credentialService: ConnectorCredentialService,
  ) {}

  @Post()
  @ApiCreatedResponse({
    description: 'Connector registered',
    type: ConnectorCredentialResponseDto,
  })
  @ApiUnprocessableEntityResponse({
    description: 'Connectivity to the connector endpoint could not be verified',
  })
  @ApiBody({
    description: 'Connector registration request',
    type: CreateConnectorCredentialDto,
    examples: {
      example1: {
        summary: 'Register a Traction connector',
        value: {
          connector_type: 'traction',
          endpoint_url: 'https://api.example.com/v1',
          credentials: { api_key: 'integration-secret' },
        },
      },
    },
  })
  public async create(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateConnectorCredentialDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ConnectorCredentialResponseDto> {
    const credential = await this.credentialService.create(tenantId, dto, auth);
    return this.toResponseDto(credential);
  }

  @Get()
  @ApiOkResponse({
    description: 'List of connectors for the tenant',
    type: [ConnectorCredentialResponseDto],
  })
  public async findByTenant(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ): Promise<ConnectorCredentialResponseDto[]> {
    const credentials = await this.credentialService.findByTenant(tenantId);
    return credentials.map((credential) => this.toResponseDto(credential));
  }

  @Get(':id')
  @ApiOkResponse({
    description: 'Connector details',
    type: ConnectorCredentialResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Connector not found' })
  public async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ConnectorCredentialResponseDto> {
    const credential = await this.credentialService.findById(id, auth);
    return this.toResponseDto(credential);
  }

  @Patch(':id')
  @ApiOkResponse({
    description: 'Connector updated',
    type: ConnectorCredentialResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Connector not found' })
  @ApiUnprocessableEntityResponse({
    description: 'Connectivity to the connector endpoint could not be verified',
  })
  @ApiBody({
    description: 'Connector update request',
    type: UpdateConnectorCredentialDto,
    examples: {
      example1: {
        summary: 'Update the connector endpoint URL',
        value: {
          endpoint_url: 'https://traction.example.com/api/v2',
        },
      },
      example2: {
        summary: 'Rotate connector credentials',
        value: {
          credentials: { api_key: 'sk_live_new456' },
        },
      },
    },
  })
  public async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConnectorCredentialDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ConnectorCredentialResponseDto> {
    const credential = await this.credentialService.update(id, dto, auth);
    return this.toResponseDto(credential);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Connector removed' })
  @ApiNotFoundResponse({ description: 'Connector not found' })
  @ApiConflictResponse({
    description: 'Active credential records still reference this connector',
  })
  public async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    return await this.credentialService.delete(id, auth);
  }

  @Post(':id/test')
  @ApiOkResponse({ description: 'Connectivity test result' })
  @ApiNotFoundResponse({ description: 'Connector not found' })
  public async test(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<{ status: string; latencyMs: number; message?: string }> {
    return await this.credentialService.testConnectivity(id, auth);
  }

  private toResponseDto(
    credential: ConnectorCredential,
  ): ConnectorCredentialResponseDto {
    return ConnectorCredentialResponseDto.fromEntity(credential);
  }
}
