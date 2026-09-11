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
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
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
import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import { ConnectionService } from './connection.service';
import {
  ConnectionResponseDto,
  ConnectionsPaginationDto,
  PaginatedConnectionsResponseDto,
} from './dto/connection-response.dto';
import { CreateConnectionDto } from './dto/create-connection.dto';
import { ListConnectionsQueryDto } from './dto/list-connections-query.dto';

@SkipAutoAudit()
@ApiJwtAuth()
@UseGuards(
  JwtGuard,
  ScopeGuard,
  TenantGuard,
  TenantStatusGuard,
  TenantTierRateLimitGuard,
)
@RequireScopes(CONNECTIONS_MANAGE_SCOPE)
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@ApiForbiddenResponse({
  description: 'Token lacks connections:manage, or tenant claim does not match',
})
@Controller({ path: 'tenants/:tenantId/connections', version: API_VERSION })
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
          protocol: 'didcomm-v2',
          alias: 'acme-partner',
          metadata: { key: 'value' },
        },
      },
    },
  })
  public async create(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateConnectionDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ConnectionResponseDto> {
    const connection = await this.connectionService.create(tenantId, dto, auth);

    return ConnectionResponseDto.fromEntity(connection);
  }

  @Get()
  @ApiOkResponse({
    description: 'Paginated list of connections for the specified tenant',
    type: PaginatedConnectionsResponseDto,
  })
  @ApiQuery({
    name: 'state',
    required: false,
    description: 'Filter connections by state',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Opaque pagination cursor from a previous response',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum number of connections to return (default 20)',
  })
  @ApiNotFoundResponse({ description: 'Tenant not found' })
  public async findByTenantId(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: ListConnectionsQueryDto,
  ): Promise<PaginatedConnectionsResponseDto> {
    const options = { limit: query.limit, cursor: query.cursor };
    const page = query.state
      ? await this.connectionService.findByTenantIdAndState(
          tenantId,
          query.state,
          options,
        )
      : await this.connectionService.findByTenantId(tenantId, options);

    return {
      data: page.data.map((connection) =>
        ConnectionResponseDto.fromEntity(connection),
      ),
      pagination: ConnectionsPaginationDto.from(
        page.pagination.next_cursor,
        page.pagination.has_more,
      ),
    };
  }

  @Get(':id')
  @ApiOkResponse({
    description: 'Connection found',
    type: ConnectionResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Connection not found' })
  public async findById(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ConnectionResponseDto> {
    const connection = await this.connectionService.findById(
      tenantId,
      id,
      auth,
    );

    return ConnectionResponseDto.fromEntity(connection);
  }

  @Delete(':id')
  @ApiOkResponse({ description: 'Connection deleted successfully' })
  @ApiNotFoundResponse({ description: 'Connection not found' })
  public async delete(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    return await this.connectionService.delete(tenantId, id, auth);
  }
}
