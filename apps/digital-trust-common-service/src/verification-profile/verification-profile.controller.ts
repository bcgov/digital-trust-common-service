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
import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import { CreateVerificationProfileDto } from './dto/create-verification-profile.dto';
import { ListVerificationProfilesQueryDto } from './dto/list-verification-profiles-query.dto';
import { UpdateVerificationProfileDto } from './dto/update-verification-profile.dto';
import {
  PaginatedVerificationProfilesResponseDto,
  VerificationProfileResponseDto,
  VerificationProfilesPaginationDto,
} from './dto/verification-profile-response.dto';
import { VerificationProfileStatus } from './verification-profile.entity';
import { VerificationProfileService } from './verification-profile.service';

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
  path: 'tenants/:tenantId/profiles/verification',
  version: API_VERSION,
})
export class VerificationProfileController {
  public constructor(
    private readonly verificationProfileService: VerificationProfileService,
  ) {}

  @Post()
  @ApiCreatedResponse({
    description: 'Verification profile created successfully (draft status)',
    type: VerificationProfileResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Issuance profile not found' })
  @ApiBadRequestResponse({
    description:
      'Issuance profile is not published, presentation_definition is not a ' +
      'valid DIF Presentation Exchange object, requested_attributes or ' +
      "predicates reference attributes not in the issuance profile's " +
      'attribute_schema',
  })
  @ApiConflictResponse({
    description:
      'A verification profile with this name and version already exists for this tenant',
  })
  @ApiBody({
    description: 'Verification profile creation request',
    type: CreateVerificationProfileDto,
    examples: {
      example1: {
        summary: 'Create a verification profile',
        value: {
          name: 'age-verification',
          version: '1.0',
          description: 'Verifies the holder is over 19',
          issuance_profile_id: '123e4567-e89b-12d3-a456-426614174000',
          presentation_definition: {
            id: 'age-over-18',
            input_descriptors: [
              {
                id: 'person_credential',
                constraints: {
                  fields: [{ path: ['$.credentialSubject.given_names'] }],
                },
              },
            ],
          },
          public: false,
          protocol_hint: 'auto',
        },
      },
    },
  })
  public async create(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateVerificationProfileDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<VerificationProfileResponseDto> {
    const profile = await this.verificationProfileService.create(
      tenantId,
      dto,
      auth,
    );

    return VerificationProfileResponseDto.fromEntity(profile);
  }

  @Get()
  @ApiOkResponse({
    description: 'Paginated list of verification profiles for the tenant',
    type: PaginatedVerificationProfilesResponseDto,
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: VerificationProfileStatus,
  })
  @ApiQuery({ name: 'issuance_profile_id', required: false })
  @ApiQuery({ name: 'public', required: false })
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
    @Query() query: ListVerificationProfilesQueryDto,
  ): Promise<PaginatedVerificationProfilesResponseDto> {
    const page = await this.verificationProfileService.findByTenantId(
      tenantId,
      {
        status: query.status,
        issuanceProfileId: query.issuanceProfileId,
        isPublic: query.isPublic,
      },
      { limit: query.limit, cursor: query.cursor },
    );

    return {
      data: page.data.map((profile) =>
        VerificationProfileResponseDto.fromEntity(profile),
      ),
      pagination: VerificationProfilesPaginationDto.from(page.pagination),
    };
  }

  @Get(':id')
  @ApiOkResponse({
    description: 'Verification profile found',
    type: VerificationProfileResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Verification profile not found' })
  public async findById(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<VerificationProfileResponseDto> {
    const profile = await this.verificationProfileService.findById(
      tenantId,
      id,
      auth,
    );

    return VerificationProfileResponseDto.fromEntity(profile);
  }

  @Patch(':id')
  @ApiOkResponse({
    description: 'Verification profile updated successfully',
    type: VerificationProfileResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Verification profile not found' })
  @ApiBadRequestResponse({
    description:
      'requested_attributes or predicates reference attributes not in ' +
      "the issuance profile's attribute_schema",
  })
  @ApiConflictResponse({
    description: 'Cannot update a published or deprecated profile',
  })
  @ApiBody({
    description: 'Verification profile update request',
    type: UpdateVerificationProfileDto,
    examples: {
      example1: {
        summary: 'Update verification profile description',
        value: { description: 'Updated description' },
      },
    },
  })
  public async update(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVerificationProfileDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<VerificationProfileResponseDto> {
    const profile = await this.verificationProfileService.update(
      tenantId,
      id,
      dto,
      auth,
    );

    return VerificationProfileResponseDto.fromEntity(profile);
  }

  @Post(':id/publish')
  @ApiOkResponse({
    description: 'Verification profile published successfully',
    type: VerificationProfileResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Verification profile not found' })
  @ApiConflictResponse({
    description: 'Verification profile is not in draft status',
  })
  public async publish(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<VerificationProfileResponseDto> {
    const profile = await this.verificationProfileService.publish(
      tenantId,
      id,
      auth,
    );

    return VerificationProfileResponseDto.fromEntity(profile);
  }

  @Post(':id/deprecate')
  @ApiOkResponse({
    description: 'Verification profile deprecated successfully',
    type: VerificationProfileResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Verification profile not found' })
  @ApiConflictResponse({
    description: 'Verification profile is not in published status',
  })
  public async deprecate(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<VerificationProfileResponseDto> {
    const profile = await this.verificationProfileService.deprecate(
      tenantId,
      id,
      auth,
    );

    return VerificationProfileResponseDto.fromEntity(profile);
  }
}
