import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';

import {
  CredentialDefinition,
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
} from './credential-definition.entity';
import { CredentialDefinitionService } from './credential-definition.service';
import { CreateCredentialDefinitionDto } from './dto/create-credential-definition.dto';
import { UpdateCredentialDefinitionDto } from './dto/update-credential-definition.dto';

@Controller('credential-definitions')
export class CredentialDefinitionController {
  public constructor(
    private readonly credentialDefinitionService: CredentialDefinitionService,
  ) {}

  @Post()
  @ApiCreatedResponse({
    description: 'Credential definition created successfully',
    type: CredentialDefinition,
  })
  @ApiBody({
    description: 'Credential definition creation request',
    type: CreateCredentialDefinitionDto,
    examples: {
      example1: {
        summary: 'Create a credential definition',
        value: {
          tenantId: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Driver License Definition',
          format: 'anoncreds',
          externalId: 'ext-cred-def-001',
          connectorType: 'traction',
          schemaDefinition: { version: '1.0', attributes: ['name', 'age'] },
          metadata: { issuer: 'DMV' },
        },
      },
    },
  })
  public async create(
    @Body() dto: CreateCredentialDefinitionDto,
  ): Promise<CredentialDefinition> {
    return await this.credentialDefinitionService.create(dto);
  }

  @Get(':id')
  @ApiOkResponse({
    description: 'Credential definition found',
    type: CredentialDefinition,
  })
  @ApiNotFoundResponse({ description: 'Credential definition not found' })
  public async findById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CredentialDefinition> {
    return await this.credentialDefinitionService.findById(id);
  }

  @Get('tenant/:tenantId')
  @ApiOkResponse({
    description: 'List of credential definitions for the tenant',
    type: [CredentialDefinition],
  })
  @ApiNotFoundResponse({ description: 'Tenant not found' })
  public async findByTenantId(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ): Promise<CredentialDefinition[]> {
    return await this.credentialDefinitionService.findByTenantId(tenantId);
  }

  @Get('format/:format')
  @ApiOkResponse({
    description: 'List of credential definitions for the specified format',
    type: [CredentialDefinition],
  })
  public async findByFormat(
    @Param('format', new ParseEnumPipe(CredentialDefinitionFormat))
    format: CredentialDefinitionFormat,
  ): Promise<CredentialDefinition[]> {
    return await this.credentialDefinitionService.findByFormat(format);
  }

  @Get('connector/:connectorType')
  @ApiOkResponse({
    description:
      'List of credential definitions for the specified connector type',
    type: [CredentialDefinition],
  })
  public async findByConnector(
    @Param(
      'connectorType',
      new ParseEnumPipe(CredentialDefinitionConnectorType),
    )
    connectorType: CredentialDefinitionConnectorType,
  ): Promise<CredentialDefinition[]> {
    return await this.credentialDefinitionService.findByConnector(
      connectorType,
    );
  }

  @Patch(':id')
  @ApiOkResponse({
    description: 'Credential definition updated successfully',
    type: CredentialDefinition,
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
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCredentialDefinitionDto,
  ): Promise<CredentialDefinition> {
    return await this.credentialDefinitionService.update(id, dto);
  }

  @Delete(':id')
  @ApiOkResponse({ description: 'Credential definition deleted successfully' })
  @ApiNotFoundResponse({ description: 'Credential definition not found' })
  public async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return await this.credentialDefinitionService.delete(id);
  }
}
