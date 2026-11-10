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
  HttpCode,
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
import { OperationResponseDto } from '../operation/dto/operation-response.dto';
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
    description:
      'Completed issuance-profile.create operation with the draft profile in result',
    type: OperationResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Credential definition not found' })
  @ApiBadRequestResponse({
    description:
      'Claim constraints or delivery configuration are invalid, ' +
      'or the credential definition connector binding is missing, unavailable, or incompatible',
  })
  @ApiConflictResponse({
    description:
      'An issuance profile with this name and version already exists for this tenant',
  })
  @ApiBody({
    description:
      'Issuance profile creation request. The connector is inherited from the credential definition.',
    type: CreateIssuanceProfileDto,
    examples: {
      example1: {
        summary: 'Create an issuance profile',
        value: {
          name: 'drivers-license',
          version: '1.0',
          description: "Standard driver's license issuance profile",
          credential_definition_id: '123e4567-e89b-12d3-a456-426614174000',
          claim_constraints: {
            '/given_name': { value_type: 'string', required: true },
            '/family_name': { value_type: 'string', required: true },
          },
          delivery: { protocol: 'didcomm-v1' },
        },
      },
    },
  })
  public async create(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateIssuanceProfileDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<OperationResponseDto> {
    const operation = await this.issuanceProfileService.create(
      tenantId,
      dto,
      auth,
    );

    return OperationResponseDto.fromEntity(operation);
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
    description:
      'Completed issuance-profile.update operation with the updated profile in result',
    type: OperationResponseDto,
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
  ): Promise<OperationResponseDto> {
    const operation = await this.issuanceProfileService.update(
      tenantId,
      id,
      dto,
      auth,
    );

    return OperationResponseDto.fromEntity(operation);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Completed issuance-profile.publish operation with the published profile in result',
    type: OperationResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Issuance profile not found' })
  @ApiBadRequestResponse({
    description:
      'The credential definition is not published, or its connector no longer exists, is inactive, or its ' +
      'adapter no longer resolves',
  })
  @ApiConflictResponse({
    description: 'Issuance profile is not in draft status',
  })
  public async publish(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<OperationResponseDto> {
    const operation = await this.issuanceProfileService.publish(
      tenantId,
      id,
      auth,
    );

    return OperationResponseDto.fromEntity(operation);
  }

  @Post(':id/deprecate')
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Completed issuance-profile.deprecate operation with the deprecated profile in result',
    type: OperationResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Issuance profile not found' })
  @ApiConflictResponse({
    description: 'Issuance profile is not in published status',
  })
  public async deprecate(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<OperationResponseDto> {
    const operation = await this.issuanceProfileService.deprecate(
      tenantId,
      id,
      auth,
    );

    return OperationResponseDto.fromEntity(operation);
  }
}
