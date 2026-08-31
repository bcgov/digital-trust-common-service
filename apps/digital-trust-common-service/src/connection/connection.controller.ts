import {
  ApiJwtAuth,
  CONNECTIONS_MANAGE_SCOPE,
  CurrentAuth,
  JwtGuard,
  RequireScopes,
  ScopeGuard,
  TenantGuard,
  type AuthContext,
} from '@app/auth';
import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  ParseEnumPipe,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiQuery,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { SkipAutoAudit } from '../audit-log/skip-auto-audit.decorator';
import { API_VERSION } from '../common/constants/api-version.constants';

import { ConnectionState } from './connection.entity';
import { ConnectionService } from './connection.service';
import { ConnectionResponseDto } from './dto/connection-response.dto';
import { CreateConnectionDto } from './dto/create-connection.dto';
import { UpdateConnectionDto } from './dto/update-connection.dto';

@SkipAutoAudit()
@ApiJwtAuth()
@UseGuards(JwtGuard, ScopeGuard, TenantGuard)
@UseInterceptors(ClassSerializerInterceptor)
@RequireScopes(CONNECTIONS_MANAGE_SCOPE)
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@ApiForbiddenResponse({
  description: 'Token lacks connections:manage, or tenant claim does not match',
})
@Controller({ path: 'connections', version: API_VERSION })
export class ConnectionController {
  public constructor(private readonly connectionService: ConnectionService) {}

  @Post()
  @ApiCreatedResponse({
    description: 'Connection created successfully',
    type: ConnectionResponseDto,
  })
  @ApiBody({
    description: 'Connection creation request',
    type: CreateConnectionDto,
    examples: {
      example1: {
        summary: 'Create a new connection',
        value: {
          tenant_id: '123e4567-e89b-12d3-a456-426614174000',
          external_connection_id: 'ext-conn-001',
          state: 'invited',
          connector_type: 'traction',
          protocol: 'didcomm-v2',
          their_label: 'Alice',
          their_did: 'did:example:alice',
          metadata: { key: 'value' },
        },
      },
    },
  })
  public async create(
    @Body() dto: CreateConnectionDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ConnectionResponseDto> {
    const connection = await this.connectionService.create(dto, auth);

    return ConnectionResponseDto.fromEntity(connection);
  }

  @Get('tenant/:tenantId')
  @ApiOkResponse({
    description: 'List of connections for the specified tenant',
    type: [ConnectionResponseDto],
  })
  @ApiQuery({
    name: 'state',
    required: false,
    description: 'Filter connections by state',
  })
  @ApiNotFoundResponse({ description: 'Tenant not found' })
  public async findByTenantId(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query('state', new ParseEnumPipe(ConnectionState, { optional: true }))
    state?: ConnectionState,
  ): Promise<ConnectionResponseDto[]> {
    const connections = state
      ? await this.connectionService.findByTenantIdAndState(tenantId, state)
      : await this.connectionService.findByTenantId(tenantId);

    return connections.map((connection) =>
      ConnectionResponseDto.fromEntity(connection),
    );
  }

  @Get('external/:externalConnectionId')
  @ApiOkResponse({
    description: 'Connection found by external connection ID',
    type: ConnectionResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Connection not found' })
  public async findByExternalConnectionId(
    @Param('externalConnectionId') externalConnectionId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ConnectionResponseDto> {
    const connection = await this.connectionService.findByExternalConnectionId(
      externalConnectionId,
      auth,
    );

    return ConnectionResponseDto.fromEntity(connection);
  }

  @Get(':id')
  @ApiOkResponse({
    description: 'Connection found',
    type: ConnectionResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Connection not found' })
  public async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ConnectionResponseDto> {
    const connection = await this.connectionService.findById(id, auth);

    return ConnectionResponseDto.fromEntity(connection);
  }

  @Patch(':id')
  @ApiOkResponse({
    description: 'Connection updated successfully',
    type: ConnectionResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Connection not found' })
  @ApiBody({
    description: 'Connection update request',
    type: UpdateConnectionDto,
    examples: {
      example1: {
        summary: 'Update connection state',
        value: {
          state: 'active',
        },
      },
      example2: {
        summary: 'Update connection label and metadata',
        value: {
          their_label: 'Bob',
          metadata: { status: 'connected', lastSeen: '2026-07-24' },
        },
      },
    },
  })
  public async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConnectionDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ConnectionResponseDto> {
    const connection = await this.connectionService.update(id, dto, auth);

    return ConnectionResponseDto.fromEntity(connection);
  }

  @Delete(':id')
  @ApiOkResponse({ description: 'Connection deleted successfully' })
  @ApiNotFoundResponse({ description: 'Connection not found' })
  public async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    return await this.connectionService.delete(id, auth);
  }
}
