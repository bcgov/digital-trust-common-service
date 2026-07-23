import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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

import { CreateTenantUserDto } from './dto/create-tenant-user.dto';
import { UpdateTenantUserDto } from './dto/update-tenant-user.dto';
import { TenantUser } from './tenant-user.entity';
import { TenantUserService } from './tenant-user.service';

@Controller('tenant-users')
export class TenantUserController {
  public constructor(private readonly tenantUserService: TenantUserService) {}

  @Post()
  @ApiCreatedResponse({
    description: 'Tenant user created successfully',
    type: TenantUser,
  })
  @ApiBody({
    description: 'Tenant user creation request',
    type: CreateTenantUserDto,
    examples: {
      example1: {
        summary: 'Create a tenant user',
        value: {
          tenantId: '123e4567-e89b-12d3-a456-426614174000',
          externalUserId: 'ext-user-001',
          email: 'john.doe@example.com',
          displayName: 'John Doe',
          role: 'admin',
          status: 'active',
        },
      },
    },
  })
  public async create(@Body() dto: CreateTenantUserDto): Promise<TenantUser> {
    return await this.tenantUserService.create(dto);
  }

  @Get(':id')
  @ApiOkResponse({
    description: 'Tenant user found',
    type: TenantUser,
  })
  @ApiNotFoundResponse({ description: 'Tenant user not found' })
  public async findById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TenantUser> {
    return await this.tenantUserService.findById(id);
  }

  @Get('tenant/:tenantId')
  @ApiOkResponse({
    description: 'List of tenant users for the specified tenant',
    type: [TenantUser],
  })
  @ApiNotFoundResponse({ description: 'Tenant not found' })
  public async findByTenantId(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ): Promise<TenantUser[]> {
    return await this.tenantUserService.findByTenantId(tenantId);
  }

  @Get('external/:externalUserId')
  @ApiOkResponse({
    description: 'List of tenant users with the specified external user ID',
    type: [TenantUser],
  })
  public async findByExternalUserId(
    @Param('externalUserId') externalUserId: string,
  ): Promise<TenantUser[]> {
    return await this.tenantUserService.findByExternalUserId(externalUserId);
  }

  @Patch(':id')
  @ApiOkResponse({
    description: 'Tenant user updated successfully',
    type: TenantUser,
  })
  @ApiNotFoundResponse({ description: 'Tenant user not found' })
  @ApiBody({
    description: 'Tenant user update request',
    type: UpdateTenantUserDto,
    examples: {
      example1: {
        summary: 'Update user role and status',
        value: {
          role: 'member',
          status: 'active',
        },
      },
      example2: {
        summary: 'Update user display name',
        value: {
          displayName: 'Jane Doe',
        },
      },
    },
  })
  public async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTenantUserDto,
  ): Promise<TenantUser> {
    return await this.tenantUserService.update(id, dto);
  }

  @Delete(':id')
  @ApiOkResponse({ description: 'Tenant user deleted successfully' })
  @ApiNotFoundResponse({ description: 'Tenant user not found' })
  public async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return await this.tenantUserService.delete(id);
  }
}
