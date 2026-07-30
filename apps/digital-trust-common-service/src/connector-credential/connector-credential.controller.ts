import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
} from '@nestjs/swagger';

import { API_VERSION } from '../common/constants/api-version.constants';
import { ConnectorType } from '../connection/connection.entity';

import { ConnectorCredential } from './connector-credential.entity';
import { ConnectorCredentialService } from './connector-credential.service';
import { ConnectorCredentialResponseDto } from './dto/connector-credential-response.dto';
import { CreateConnectorCredentialDto } from './dto/create-connector-credential.dto';
import { UpdateConnectorCredentialDto } from './dto/update-connector-credential.dto';

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
          tenantId: '123e4567-e89b-12d3-a456-426614174000',
          connectorType: 'traction',
          credentialsEncrypted: 'base64encodedencryptedcredentials==',
          endpointUrl: 'https://api.example.com/v1',
          active: true,
          keyVersion: 1,
        },
      },
    },
  })
  public async create(
    @Body() dto: CreateConnectorCredentialDto,
  ): Promise<ConnectorCredentialResponseDto> {
    const credential = await this.credentialService.create(dto);
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
  ): Promise<ConnectorCredentialResponseDto> {
    const credential = await this.credentialService.findById(id);
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
          endpointUrl: 'https://api.updated.com/v2',
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
  ): Promise<ConnectorCredentialResponseDto> {
    const credential = await this.credentialService.update(id, dto);
    return this.toResponseDto(credential);
  }

  @Delete(':id')
  @ApiOkResponse({ description: 'Connector credential deleted successfully' })
  @ApiNotFoundResponse({ description: 'Connector credential not found' })
  public async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return await this.credentialService.delete(id);
  }

  private toResponseDto(
    credential: ConnectorCredential,
  ): ConnectorCredentialResponseDto {
    return {
      id: credential.id,
      tenantId: credential.tenantId,
      connectorType: credential.connectorType,
      endpointUrl: credential.endpointUrl,
      active: credential.active,
      keyVersion: credential.keyVersion,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    };
  }
}
