import { ApiJwtAuth, JwtGuard } from '@app/auth';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { API_VERSION } from '../common/constants/api-version.constants';

import { ScopeListResponseDto } from './dto/role-scope.dto';
import { RoleScopeService } from './role-scope.service';

/**
 * The scope catalog is non-secret, but it is not served anonymously: it
 * publishes the platform's full capability taxonomy, and there is no rate
 * limiting in front of unauthenticated routes yet (AG-03 #77). Any
 * authenticated principal may read it, including `readonly`.
 */
@ApiTags('admin')
@ApiJwtAuth()
@Controller({ path: 'scopes', version: API_VERSION })
@UseGuards(JwtGuard)
export class ScopeController {
  public constructor(private readonly roleScopes: RoleScopeService) {}

  @Get()
  @ApiOperation({
    summary: 'List available scopes',
    description:
      'Returns every scope the platform recognises, with its description and privilege level.',
  })
  @ApiOkResponse({ description: 'Scope list', type: ScopeListResponseDto })
  public listScopes(): ScopeListResponseDto {
    return { data: [...this.roleScopes.getScopeCatalog()] };
  }
}
