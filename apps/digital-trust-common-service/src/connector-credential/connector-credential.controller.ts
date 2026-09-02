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
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { API_VERSION } from '../common/constants/api-version.constants';
import { ConnectorType } from '../connection/connection.entity';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import { ConnectorCredential } from './connector-credential.entity';
import { ConnectorCredentialService } from './connector-credential.service';
import { ConnectorCredentialResponseDto } from './dto/connector-credential-response.dto';
import { CreateConnectorCredentialDto } from './dto/create-connector-credential.dto';
import { DecryptConnectorCredentialDto } from './dto/decrypt-connector-credential.dto';
import { UpdateConnectorCredentialDto } from './dto/update-connector-credential.dto';

@ApiJwtAuth()
@UseGuards(JwtGuard, ScopeGuard, TenantGuard, TenantStatusGuard)
@RequireScopes(TENANT_SUPERUSER_SCOPE)
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@ApiForbiddenResponse({
  description: 'Token lacks tenants:admin, or tenant claim does not match',
})
@Controller({ path: 'connector-credentials', version: API_VERSION })
export class ConnectorCredentialController {
  public constructor(
    private readonly credentialService: ConnectorCredentialService,
  ) {}

  @Post()
  @ApiCreatedResponse({
    description: 'Connector credential created successfully',
    type: ConnectorCredentialResponseDto,
  })
  @ApiBody({
    description: 'Connector credential creation request',
    type: CreateConnectorCredentialDto,
    examples: {
      example1: {
        summary: 'Create a connector credential',
        value: {
          tenant_id: '123e4567-e89b-12d3-a456-426614174000',
          connector_type: 'traction',
          credentials_plain_text: 'base64plaintextcredentials==',
          endpoint_url: 'https://api.example.com/v1',
          active: true,
        },
      },
    },
  })
  public async create(
    @Body() dto: CreateConnectorCredentialDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ConnectorCredentialResponseDto> {
    const credential = await this.credentialService.create(dto, auth);
    return this.toResponseDto(credential);
  }

  @Get('tenant/:tenantId')
  @ApiOkResponse({
    description: 'List of connector credentials for the specified tenant',
    type: [ConnectorCredentialResponseDto],
  })
  public async findByTenant(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query('connectorType') connectorType?: ConnectorType,
    @Query('active') active?: string,
  ): Promise<ConnectorCredentialResponseDto[]> {
    let credentials;

    if (connectorType && active !== undefined) {
      const isActive = active === 'true';
      credentials =
        await this.credentialService.findByTenantAndConnectorTypeAndActive(
          tenantId,
          connectorType,
          isActive,
        );
    } else if (connectorType) {
      credentials = await this.credentialService.findByTenantAndConnectorType(
        tenantId,
        connectorType,
      );
    } else {
      credentials = await this.credentialService.findByTenant(tenantId);
    }

    return credentials.map((credential) => this.toResponseDto(credential));
  }

  @Get(':id')
  @ApiOkResponse({
    description: 'Connector credential found',
    type: ConnectorCredentialResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Connector credential not found' })
  public async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ConnectorCredentialResponseDto> {
    const credential = await this.credentialService.findById(id, auth);
    return this.toResponseDto(credential);
  }

  @Patch(':id')
  @ApiOkResponse({
    description: 'Connector credential updated successfully',
    type: ConnectorCredentialResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Connector credential not found' })
  @ApiBody({
    description: 'Connector credential update request',
    type: UpdateConnectorCredentialDto,
    examples: {
      example1: {
        summary: 'Update credential endpoint URL',
        value: {
          endpoint_url: 'https://api.updated.com/v2',
        },
      },
      example2: {
        summary: 'Activate credential and update key version',
        value: {
          active: true,
          keyVersion: 2,
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
  @ApiOkResponse({ description: 'Connector credential deleted successfully' })
  @ApiNotFoundResponse({ description: 'Connector credential not found' })
  public async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    return await this.credentialService.delete(id, auth);
  }

  @Post(':id/decrypt')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  @ApiOkResponse({
    description: 'Connector credential decrypted successfully',
    type: String,
  })
  @ApiNotFoundResponse({ description: 'Connector credential not found' })
  @ApiBody({
    description: 'Request body containing the decryption key',
    type: DecryptConnectorCredentialDto,
    examples: {
      example1: {
        summary: 'Decrypt a connector credential',
        value: {
          key: '25a1d9892813680c2a7e6363818f22005b633d394083f3da8937c405d1ef9f86',
        },
      },
    },
  })
  public async decrypt(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecryptConnectorCredentialDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<string> {
    return await this.credentialService.decryptCredential(dto.key, id, auth);
  }

  private toResponseDto(
    credential: ConnectorCredential,
  ): ConnectorCredentialResponseDto {
    return ConnectorCredentialResponseDto.fromEntity(credential);
  }
}
