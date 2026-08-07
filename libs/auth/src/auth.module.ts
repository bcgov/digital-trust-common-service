import { OidcConfigModule } from '@app/oidc';
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { JwtAuthExceptionFilter } from './filters/jwt-auth.exception-filter';
import { JwtGuard } from './guards/jwt.guard';
import { ScopeGuard } from './guards/scope.guard';
import { TenantGuard } from './guards/tenant.guard';
import { JwksCacheService } from './services/jwks-cache.service';
import { JwtValidationService } from './services/jwt-validation.service';

@Module({
  imports: [OidcConfigModule],
  providers: [
    JwksCacheService,
    JwtValidationService,
    JwtGuard,
    ScopeGuard,
    TenantGuard,
    {
      provide: APP_FILTER,
      useClass: JwtAuthExceptionFilter,
    },
  ],
  exports: [
    JwksCacheService,
    JwtValidationService,
    JwtGuard,
    ScopeGuard,
    TenantGuard,
  ],
})
export class AuthModule {}
