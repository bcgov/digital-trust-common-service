import {
  ApiJwtAuth,
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
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { SkipAutoAudit } from '../audit-log/skip-auto-audit.decorator';
import { API_VERSION } from '../common/constants/api-version.constants';
import { CredentialDefinitionFormat } from '../credential-definition/credential-definition.entity';
import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import { CreateIssuanceProfileDto } from './dto/create-issuance-profile.dto';
import {
  IssuanceProfileResponseDto,
  IssuanceProfilesPaginationDto,
  PaginatedIssuanceProfilesResponseDto,
} from './dto/issuance-profile-response.dto';
import { ListIssuanceProfilesQueryDto } from './dto/list-issuance-profiles-query.dto';
import { UpdateIssuanceProfileDto } from './dto/update-issuance-profile.dto';
import { IssuanceProfileStatus } from './issuance-profile.entity';
import { IssuanceProfileService } from './issuance-profile.service';

@SkipAutoAudit()
@ApiJwtAuth()
@UseGuards(
  JwtGuard,
  ScopeGuard,
  TenantGuard,
  TenantStatusGuard,
  TenantTierRateLimitGuard,
)
@RequireScopes('profiles:manage')
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@ApiForbiddenResponse({
  description: 'Token lacks profiles:manage, or tenant claim does not match',
})
@Controller({
  path: 'tenants/:tenantId/profiles/issuance',
  version: API_VERSION,
})
export class IssuanceProfileController {
  public constructor(
    private readonly issuanceProfileService: IssuanceProfileService,
  ) {}

  @Post()
  @ApiCreatedResponse({
    description: 'Issuance profile created successfully (draft status)',
    type: IssuanceProfileResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Credential definition not found' })
  @ApiBadRequestResponse({
    description:
      'attribute_schema is not a subset of the credential definition schema, ' +
      'or connector_id does not support the credential definition format',
  })
  @ApiConflictResponse({
    description:
      'An issuance profile with this name and version already exists for this tenant',
  })
  @ApiBody({
    description: 'Issuance profile creation request',
    type: CreateIssuanceProfileDto,
    examples: {
      example1: {
        summary: 'Create an issuance profile',
        value: {
          name: 'drivers-license',
          version: '1.0',
          description: "Standard driver's license issuance profile",
          credential_definition_id: '123e4567-e89b-12d3-a456-426614174000',
          attribute_schema: {
            given_name: { type: 'string', required: true },
            family_name: { type: 'string', required: true },
          },
          protocol_hint: 'auto',
        },
      },
    },
  })
  public async create(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateIssuanceProfileDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<IssuanceProfileResponseDto> {
    const profile = await this.issuanceProfileService.create(
      tenantId,
      dto,
      auth,
    );

    return IssuanceProfileResponseDto.fromEntity(profile);
  }

  @Get()
  @ApiOkResponse({
    description: 'Paginated list of issuance profiles for the tenant',
    type: PaginatedIssuanceProfilesResponseDto,
  })
  @ApiQuery({ name: 'status', required: false, enum: IssuanceProfileStatus })
  @ApiQuery({
    name: 'format',
    required: false,
    enum: CredentialDefinitionFormat,
  })
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Opaque pagination cursor from a previous response',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Page size (1-100, default 20)',
  })
  public async findByTenantId(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: ListIssuanceProfilesQueryDto,
  ): Promise<PaginatedIssuanceProfilesResponseDto> {
    const page = await this.issuanceProfileService.findByTenantId(
      tenantId,
      {
        status: query.status,
        format: query.format,
        name: query.name,
      },
      { limit: query.limit, cursor: query.cursor },
    );

    return {
      data: page.data.map((profile) =>
        IssuanceProfileResponseDto.fromEntity(profile),
      ),
      pagination: IssuanceProfilesPaginationDto.from(page.pagination),
    };
  }

  @Get(':id')
  @ApiOkResponse({
    description: 'Issuance profile found',
    type: IssuanceProfileResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Issuance profile not found' })
  public async findById(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<IssuanceProfileResponseDto> {
    const profile = await this.issuanceProfileService.findById(
      tenantId,
      id,
      auth,
    );

    return IssuanceProfileResponseDto.fromEntity(profile);
  }

  @Patch(':id')
  @ApiOkResponse({
    description: 'Issuance profile updated successfully',
    type: IssuanceProfileResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Issuance profile not found' })
  @ApiConflictResponse({
    description: 'Cannot update a published or deprecated profile',
  })
  @ApiBody({
    description: 'Issuance profile update request',
    type: UpdateIssuanceProfileDto,
    examples: {
      example1: {
        summary: 'Update issuance profile description',
        value: { description: 'Updated description' },
      },
    },
  })
  public async update(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIssuanceProfileDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<IssuanceProfileResponseDto> {
    const profile = await this.issuanceProfileService.update(
      tenantId,
      id,
      dto,
      auth,
    );

    return IssuanceProfileResponseDto.fromEntity(profile);
  }
}
