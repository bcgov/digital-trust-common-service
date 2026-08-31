import { ApiJwtAuth, CurrentAuth, JwtGuard, type AuthContext } from '@app/auth';
import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { SkipAutoAudit } from '../audit-log/skip-auto-audit.decorator';
import { API_VERSION } from '../common/constants/api-version.constants';

import { AuthService } from './auth.service';
import { AuthTenantDto } from './dto/auth-tenant.dto';
import { SwitchTenantResponseDto } from './dto/switch-tenant-response.dto';
import { SwitchTenantDto } from './dto/switch-tenant.dto';

@ApiTags('Auth')
@ApiJwtAuth()
@SkipAutoAudit()
@UseGuards(JwtGuard)
@UseInterceptors(ClassSerializerInterceptor)
@Controller({ path: 'auth', version: API_VERSION })
export class AuthController {
  public constructor(private readonly authService: AuthService) {}

  @Get('tenants')
  @ApiOperation({
    summary: 'List tenants the current user can switch to',
    description:
      'Returns active memberships for the caller. Machine clients receive 403.',
  })
  @ApiOkResponse({ type: [AuthTenantDto] })
  @ApiForbiddenResponse({
    description: 'Caller is a machine client, not a user token',
  })
  public async listTenants(
    @CurrentAuth() auth: AuthContext,
  ): Promise<AuthTenantDto[]> {
    return await this.authService.listTenants(auth);
  }

  @Post('switch-tenant')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Switch active tenant context',
    description:
      'Exchange the current valid user token for a new token scoped to a different tenant. The previous grant is revoked.',
  })
  @ApiOkResponse({ type: SwitchTenantResponseDto })
  @ApiForbiddenResponse({
    description:
      'Caller is a machine client, or is not an active member of the target tenant',
  })
  public async switchTenant(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: SwitchTenantDto,
  ): Promise<SwitchTenantResponseDto> {
    return await this.authService.switchTenant(auth, dto.tenantId);
  }
}
