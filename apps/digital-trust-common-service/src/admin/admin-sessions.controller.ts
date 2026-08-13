import { JwtGuard, ScopeGuard } from '@app/auth';
import {
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { API_VERSION } from '../common/constants/api-version.constants';

import { AdminSessionsService } from './admin-sessions.service';
import { RevokeSessionsResponseDto } from './dto/revoke-sessions-response.dto';

// NOTE: JwtGuard/ScopeGuard are currently stub implementations that throw
// NotImplementedException, so this route responds 501 until #37 lands. That
// fails closed, which is why this destructive endpoint can ship ahead of auth.
// TODO(#37): pass the authenticated admin's subject as the audit actorId.
@ApiTags('admin')
@Controller({ path: 'admin/users', version: API_VERSION })
@UseGuards(JwtGuard, ScopeGuard)
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
  @ApiOkResponse({
    description: 'Sessions revoked',
    type: RevokeSessionsResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Tenant user not found' })
  public async revokeSessions(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RevokeSessionsResponseDto> {
    return this.adminSessionsService.revokeSessions(id);
  }
}
