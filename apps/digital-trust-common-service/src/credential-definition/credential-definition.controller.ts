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
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiAcceptedResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { SkipAutoAudit } from '../audit-log/skip-auto-audit.decorator';
import { API_VERSION } from '../common/constants/api-version.constants';
import { OperationResponseDto } from '../operation/dto/operation-response.dto';
import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import {
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
  CredentialDefinitionStatus,
} from './credential-definition.entity';
import { CredentialDefinitionService } from './credential-definition.service';
import { CreateCredentialDefinitionDto } from './dto/create-credential-definition.dto';
import {
  AnonCredsCredentialDefinitionOptionsDto,
  AnonCredsRevocationOptionsDto,
  AnonCredsStatusOptionsDto,
  CredentialDefinitionOptionsBase,
  MdlCredentialDefinitionOptionsDto,
  SdJwtCredentialDefinitionOptionsDto,
  W3cVcCredentialDefinitionOptionsDto,
} from './dto/credential-definition-options.dto';
import { CredentialDefinitionResponseDto } from './dto/credential-definition-response.dto';
import { UpdateCredentialDefinitionDto } from './dto/update-credential-definition.dto';

@SkipAutoAudit()
@ApiJwtAuth()
@ApiExtraModels(
  CredentialDefinitionOptionsBase,
  AnonCredsCredentialDefinitionOptionsDto,
  AnonCredsStatusOptionsDto,
  AnonCredsRevocationOptionsDto,
  SdJwtCredentialDefinitionOptionsDto,
  MdlCredentialDefinitionOptionsDto,
  W3cVcCredentialDefinitionOptionsDto,
)
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
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({
    description:
      'Credential definition accepted. AnonCreds registration runs asynchronously; formats without a registered handler return FORMAT_NOT_SUPPORTED.',
    type: OperationResponseDto,
  })
  @ApiCreatedResponse({
    description:
      'Local draft saved without contacting the registration backend.',
    type: CredentialDefinitionResponseDto,
  })
  @ApiConflictResponse({
    description:
      'A credential definition with this name and format already exists.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid schema, issuer selection, options, or connector',
  })
  @ApiBody({
    description: 'Credential definition creation request',
    type: CreateCredentialDefinitionDto,
    examples: {
      example1: {
        summary: 'Create a credential definition',
        value: {
          name: 'Driver License Definition',
          schema: {
            definition: {
              attr_names: ['name', 'age'],
              schema_name: 'driver-license',
              schema_version: '1.0',
            },
          },
          options: {
            format: 'anoncreds',
            tag: 'default',
            status: { revocation: { enabled: true } },
          },
          metadata: {
            issuer: 'DMV',
          },
        },
      },
    },
  })
  public async create(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateCredentialDefinitionDto,
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) response?: Response,
  ): Promise<OperationResponseDto | CredentialDefinitionResponseDto> {
    if (dto.status === CredentialDefinitionStatus.DRAFT) {
      const definition = await this.credentialDefinitionService.createDraft(
        tenantId,
        dto,
        auth,
      );
      response?.status(HttpStatus.CREATED);
      return CredentialDefinitionResponseDto.fromEntity(definition);
    }
    const operation = await this.credentialDefinitionService.create(
      tenantId,
      dto,
      auth,
    );
    return OperationResponseDto.fromEntity(operation);
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
  @ApiBadRequestResponse({
    description:
      'Schema or connector fields can only be updated while the definition is a draft. Published and deprecated definitions cannot return to draft.',
  })
  @ApiBody({
    description:
      'Credential definition update request. Schema and connector fields are draft-only.',
    type: UpdateCredentialDefinitionDto,
    examples: {
      example1: {
        summary: 'Update a draft credential definition',
        value: {
          name: 'Updated Driver License Definition',
          schema_definition: {
            attr_names: ['name', 'age', 'birthdate'],
            schema_name: 'driver-license',
            schema_version: '2.0',
            version: '2.0',
          },
          connector_id: '123e4567-e89b-12d3-a456-426614174000',
          status: 'draft',
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
