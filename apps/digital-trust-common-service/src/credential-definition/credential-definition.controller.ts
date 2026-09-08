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
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { SkipAutoAudit } from '../audit-log/skip-auto-audit.decorator';
import { API_VERSION } from '../common/constants/api-version.constants';
import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import {
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
} from './credential-definition.entity';
import { CredentialDefinitionService } from './credential-definition.service';
import { CreateCredentialDefinitionDto } from './dto/create-credential-definition.dto';
import { CredentialDefinitionResponseDto } from './dto/credential-definition-response.dto';
import { UpdateCredentialDefinitionDto } from './dto/update-credential-definition.dto';

@SkipAutoAudit()
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
@Controller({
  path: 'tenants/:tenantId/credential-definitions',
  version: API_VERSION,
})
export class CredentialDefinitionController {
  public constructor(
    private readonly credentialDefinitionService: CredentialDefinitionService,
  ) {}

  @Post()
  @ApiCreatedResponse({
    description: 'Credential definition created successfully',
    type: CredentialDefinitionResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'schema_definition failed format-specific structural validation',
  })
  @ApiBody({
    description: 'Credential definition creation request',
    type: CreateCredentialDefinitionDto,
    examples: {
      example1: {
        summary: 'Create a credential definition',
        value: {
          name: 'Driver License Definition',
          format: 'anoncreds',
          external_id: 'ext-cred-def-001',
          connector_type: 'traction',
          schema_definition: {
            attr_names: ['name', 'age'],
            schema_name: 'driver-license',
            schema_version: '1.0',
          },
          metadata: { issuer: 'DMV' },
        },
      },
    },
  })
  public async create(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateCredentialDefinitionDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<CredentialDefinitionResponseDto> {
    const credentialDefinition = await this.credentialDefinitionService.create(
      tenantId,
      dto,
      auth,
    );

    return CredentialDefinitionResponseDto.fromEntity(credentialDefinition);
  }

  @Get()
  @ApiOkResponse({
    description: 'List of credential definitions for the tenant',
    type: [CredentialDefinitionResponseDto],
  })
  @ApiNotFoundResponse({ description: 'Tenant not found' })
  public async findByTenantId(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ): Promise<CredentialDefinitionResponseDto[]> {
    const credentialDefinitions =
      await this.credentialDefinitionService.findByTenantId(tenantId);

    return credentialDefinitions.map((credentialDefinition) =>
      CredentialDefinitionResponseDto.fromEntity(credentialDefinition),
    );
  }

  @Get('format/:format')
  @ApiOkResponse({
    description: 'List of credential definitions for the specified format',
    type: [CredentialDefinitionResponseDto],
  })
  public async findByFormat(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('format', new ParseEnumPipe(CredentialDefinitionFormat))
    format: CredentialDefinitionFormat,
  ): Promise<CredentialDefinitionResponseDto[]> {
    const credentialDefinitions =
      await this.credentialDefinitionService.findByFormat(tenantId, format);

    return credentialDefinitions.map((credentialDefinition) =>
      CredentialDefinitionResponseDto.fromEntity(credentialDefinition),
    );
  }

  @Get('connector/:connectorType')
  @ApiOkResponse({
    description:
      'List of credential definitions for the specified connector type',
    type: [CredentialDefinitionResponseDto],
  })
  public async findByConnector(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param(
      'connectorType',
      new ParseEnumPipe(CredentialDefinitionConnectorType),
    )
    connectorType: CredentialDefinitionConnectorType,
  ): Promise<CredentialDefinitionResponseDto[]> {
    const credentialDefinitions =
      await this.credentialDefinitionService.findByConnector(
        tenantId,
        connectorType,
      );

    return credentialDefinitions.map((credentialDefinition) =>
      CredentialDefinitionResponseDto.fromEntity(credentialDefinition),
    );
  }

  @Get(':id')
  @ApiOkResponse({
    description: 'Credential definition found',
    type: CredentialDefinitionResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Credential definition not found' })
  public async findById(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<CredentialDefinitionResponseDto> {
    const credentialDefinition =
      await this.credentialDefinitionService.findById(tenantId, id, auth);

    return CredentialDefinitionResponseDto.fromEntity(credentialDefinition);
  }

  @Patch(':id')
  @ApiOkResponse({
    description: 'Credential definition updated successfully',
    type: CredentialDefinitionResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Credential definition not found' })
  @ApiBody({
    description: 'Credential definition update request',
    type: UpdateCredentialDefinitionDto,
    examples: {
      example1: {
        summary: 'Update credential definition metadata',
        value: {
          metadata: { issuer: 'DMV', version: '2.0' },
        },
      },
    },
  })
  public async update(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCredentialDefinitionDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<CredentialDefinitionResponseDto> {
    const credentialDefinition = await this.credentialDefinitionService.update(
      tenantId,
      id,
      dto,
      auth,
    );

    return CredentialDefinitionResponseDto.fromEntity(credentialDefinition);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({
    description: 'Credential definition deactivated successfully',
  })
  @ApiNotFoundResponse({ description: 'Credential definition not found' })
  public async delete(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    return await this.credentialDefinitionService.delete(tenantId, id, auth);
  }
}
