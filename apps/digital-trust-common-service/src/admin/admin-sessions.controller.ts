import {
  ApiJwtAuth,
  CurrentAuth,
  JwtGuard,
  PLATFORM_ADMIN_ROLE,
  RequireRoles,
  ScopeGuard,
} from '@app/auth';
import type { AuthContext } from '@app/auth';
import {
  ClassSerializerInterceptor,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { API_VERSION } from '../common/constants/api-version.constants';

import { AdminSessionsService } from './admin-sessions.service';
import { RevokeSessionsResponseDto } from './dto/revoke-sessions-response.dto';

@ApiTags('admin')
@ApiJwtAuth()
@Controller({ path: 'admin/users', version: API_VERSION })
@RequireRoles(PLATFORM_ADMIN_ROLE)
@UseGuards(JwtGuard, ScopeGuard)
@UseInterceptors(ClassSerializerInterceptor)
export class AdminSessionsController {
  public constructor(
    private readonly adminSessionsService: AdminSessionsService,
  ) {}

  @Post(':id/revoke-sessions')
  @ApiOperation({
    summary: 'Force-logout a user',
    description:
      'Deletes every OIDC session, grant, and issued token for the user, immediately terminating any in-flight refresh token chain.',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant user identifier',
    format: 'uuid',
  })
  @ApiCreatedResponse({
    description: 'Sessions revoked',
    type: RevokeSessionsResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Tenant user not found' })
  @ApiForbiddenResponse({ description: 'Caller is not a platform admin' })
  public async revokeSessions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAuth() auth?: AuthContext,
  ): Promise<RevokeSessionsResponseDto> {
    return this.adminSessionsService.revokeSessions(id, auth?.sub);
  }
}
