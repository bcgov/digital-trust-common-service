import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';

import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { Tenant } from './tenant.entity';
import { TenantService } from './tenant.service';

@Controller('tenants')
export class TenantController {
  public constructor(private readonly tenantService: TenantService) {}

  @Post()
  @ApiCreatedResponse({
    description: 'Tenant created successfully',
    type: Tenant,
  })
  @ApiBody({
    description: 'Tenant creation request',
    type: CreateTenantDto,
    examples: {
      example1: {
        summary: 'Create a new tenant',
        value: {
          name: 'Acme Corporation',
          slug: 'acme-corp',
          description: 'A sample tenant organization',
          config: { theme: 'dark', timezone: 'UTC' },
        },
      },
    },
  })
  public async create(@Body() dto: CreateTenantDto): Promise<Tenant> {
    return this.tenantService.create(dto);
  }

  @Put(':id')
  @ApiOkResponse({
    description: 'Tenant updated successfully',
    type: Tenant,
  })
  @ApiNotFoundResponse({ description: 'Tenant not found' })
  @ApiBody({
    description: 'Tenant update request',
    type: UpdateTenantDto,
    examples: {
      example1: {
        summary: 'Update tenant description and config',
        value: {
          description: 'Updated description',
          config: { theme: 'light', timezone: 'EST' },
        },
      },
    },
  })
  public async update(
    @Body() dto: UpdateTenantDto,
    @Param('id') id: string,
  ): Promise<Tenant> {
    return this.tenantService.update(id, dto);
  }

  @Get()
  @ApiOkResponse({
    description: 'List of all tenants',
    type: [Tenant],
  })
  public async findAll(): Promise<Tenant[]> {
    return this.tenantService.findAll();
  }

  @Get(':id')
  @ApiOkResponse({
    description: 'Tenant found',
    type: Tenant,
  })
  @ApiNotFoundResponse({ description: 'Tenant not found' })
  public async findById(@Param('id') id: string): Promise<Tenant | null> {
    return this.tenantService.findById(id);
  }

  @Get('slug/:slug')
  @ApiOkResponse({
    description: 'Tenant found by slug',
    type: Tenant,
  })
  @ApiNotFoundResponse({ description: 'Tenant not found' })
  public async findBySlug(@Param('slug') slug: string): Promise<Tenant | null> {
    return this.tenantService.findBySlug(slug);
  }

  @Delete(':id')
  @ApiOkResponse({ description: 'Tenant deleted successfully' })
  @ApiNotFoundResponse({ description: 'Tenant not found' })
  public async delete(@Param('id') id: string): Promise<void> {
    return this.tenantService.delete(id);
  }

  @Post(':id/restore')
  @ApiOkResponse({ description: 'Tenant restored successfully' })
  @ApiNotFoundResponse({ description: 'Tenant not found' })
  public async restore(@Param('id') id: string): Promise<void> {
    return this.tenantService.restore(id);
  }
}
