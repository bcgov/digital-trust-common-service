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
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { SkipAutoAudit } from '../audit-log/skip-auto-audit.decorator';
import { API_VERSION } from '../common/constants/api-version.constants';
import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import { ListVerificationProfilesQueryDto } from './dto/list-verification-profiles-query.dto';
import {
  CreatePresentationDefinitionDto,
  PresentationDefinitionResponseDto,
  UpdatePresentationDefinitionDto,
  PaginatedPresentationDefinitionsResponseDto,
} from './dto/presentation-definition.dto';
import { VerificationProfilesPaginationDto } from './dto/verification-profile-response.dto';
import { VerificationProfileService } from './verification-profile.service';

@SkipAutoAudit()
@ApiTags('Presentations')
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
  description: 'Requires profiles:manage and tenant access',
})
@ApiNotFoundResponse({ description: 'Presentation definition not found' })
@ApiConflictResponse({
  description: 'Duplicate identity or invalid lifecycle transition',
})
@ApiBadRequestResponse({
  description: 'Invalid or unsupported presentation query',
})
@Controller({
  path: 'tenants/:tenantId/presentation-definitions',
  version: API_VERSION,
})
export class PresentationDefinitionController {
  public constructor(private readonly profiles: VerificationProfileService) {}

  @Post()
  @ApiCreatedResponse({ type: PresentationDefinitionResponseDto })
  @ApiBody({
    type: CreatePresentationDefinitionDto,
    examples: {
      attributes: {
        value: {
          name: 'identity',
          version: '1.0',
          query: {
            type: 'dif-presentation-exchange',
            presentation_definition: {
              id: 'identity',
              input_descriptors: [
                {
                  id: 'person',
                  constraints: {
                    fields: [{ path: ['$.credentialSubject.given_names'] }],
                  },
                },
              ],
            },
          },
          options: { format: 'anoncreds' },
        },
      },
    },
  })
  public async create(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreatePresentationDefinitionDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<PresentationDefinitionResponseDto> {
    return PresentationDefinitionResponseDto.fromEntity(
      await this.profiles.createDefinition(tenantId, dto, auth),
    );
  }

  @Get()
  @ApiOkResponse({
    description:
      'Cursor-paginated definitions, including legacy verification profiles',
    type: PaginatedPresentationDefinitionsResponseDto,
  })
  public async list(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: ListVerificationProfilesQueryDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<PaginatedPresentationDefinitionsResponseDto> {
    const page = await this.profiles.findDefinitions(tenantId, query, auth);
    return {
      data: page.data.map((profile) =>
        PresentationDefinitionResponseDto.fromEntity(profile),
      ),
      pagination: VerificationProfilesPaginationDto.from(page.pagination),
    };
  }

  @Get(':id')
  @ApiOkResponse({ type: PresentationDefinitionResponseDto })
  public async get(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<PresentationDefinitionResponseDto> {
    return PresentationDefinitionResponseDto.fromEntity(
      await this.profiles.findById(tenantId, id, auth),
    );
  }

  @Patch(':id')
  @ApiBody({ type: UpdatePresentationDefinitionDto })
  @ApiOkResponse({ type: PresentationDefinitionResponseDto })
  public async update(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePresentationDefinitionDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<PresentationDefinitionResponseDto> {
    return PresentationDefinitionResponseDto.fromEntity(
      await this.profiles.updateDefinition(tenantId, id, dto, auth),
    );
  }

  @Post(':id/publish')
  @HttpCode(200)
  @ApiOkResponse({ type: PresentationDefinitionResponseDto })
  public async publish(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<PresentationDefinitionResponseDto> {
    return PresentationDefinitionResponseDto.fromEntity(
      await this.profiles.publish(tenantId, id, auth),
    );
  }

  @Post(':id/deprecate')
  @HttpCode(200)
  @ApiOkResponse({ type: PresentationDefinitionResponseDto })
  public async deprecate(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<PresentationDefinitionResponseDto> {
    return PresentationDefinitionResponseDto.fromEntity(
      await this.profiles.deprecate(tenantId, id, auth),
    );
  }
}
