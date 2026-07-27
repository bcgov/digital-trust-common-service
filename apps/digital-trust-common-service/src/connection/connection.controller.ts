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
  ParseEnumPipe,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiQuery,
} from '@nestjs/swagger';

import { Connection, ConnectionState } from './connection.entity';
import { ConnectionService } from './connection.service';
import { CreateConnectionDto } from './dto/create-connection.dto';
import { UpdateConnectionDto } from './dto/update-connection.dto';

@Controller('connections')
export class ConnectionController {
  public constructor(private readonly connectionService: ConnectionService) {}

  @Post()
  @ApiCreatedResponse({
    description: 'Connection created successfully',
    type: Connection,
  })
  public async create(@Body() dto: CreateConnectionDto): Promise<Connection> {
    return await this.connectionService.create(dto);
  }

  @Get(':id')
  @ApiOkResponse({
    description: 'Connection found',
    type: Connection,
  })
  @ApiNotFoundResponse({ description: 'Connection not found' })
  public async findById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Connection> {
    return await this.connectionService.findById(id);
  }

  @Get('external/:externalConnectionId')
  @ApiOkResponse({
    description: 'Connection found by external connection ID',
    type: Connection,
  })
  @ApiNotFoundResponse({ description: 'Connection not found' })
  public async findByExternalConnectionId(
    @Param('externalConnectionId') externalConnectionId: string,
  ): Promise<Connection> {
    return await this.connectionService.findByExternalConnectionId(
      externalConnectionId,
    );
  }

  @Get('tenant/:tenantId')
  @ApiOkResponse({
    description: 'List of connections for the specified tenant',
    type: [Connection],
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
  ): Promise<Connection[]> {
    if (state) {
      return await this.connectionService.findByTenantIdAndState(
        tenantId,
        state,
      );
    }
    return await this.connectionService.findByTenantId(tenantId);
  }

  @Patch(':id')
  @ApiOkResponse({
    description: 'Connection updated successfully',
    type: Connection,
  })
  @ApiNotFoundResponse({ description: 'Connection not found' })
  public async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConnectionDto,
  ): Promise<Connection> {
    return await this.connectionService.update(id, dto);
  }

  @Delete(':id')
  @ApiOkResponse({ description: 'Connection deleted successfully' })
  @ApiNotFoundResponse({ description: 'Connection not found' })
  public async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return await this.connectionService.delete(id);
  }
}
