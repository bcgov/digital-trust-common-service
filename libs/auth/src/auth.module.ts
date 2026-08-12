import { OidcConfigModule } from '@app/oidc';
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { InsufficientScopeExceptionFilter } from './filters/insufficient-scope.exception-filter';
import { JwtAuthExceptionFilter } from './filters/jwt-auth.exception-filter';
import { TenantAccessDeniedExceptionFilter } from './filters/tenant-access-denied.exception-filter';
import { JwtGuard } from './guards/jwt.guard';
import { ScopeGuard } from './guards/scope.guard';
import { TenantGuard } from './guards/tenant.guard';
import { JwksCacheService } from './services/jwks-cache.service';
import { JwtValidationService } from './services/jwt-validation.service';
import { ScopeAuthorizationService } from './services/scope-authorization.service';

@Module({
  imports: [OidcConfigModule],
  providers: [
    JwksCacheService,
    JwtValidationService,
    ScopeAuthorizationService,
    JwtGuard,
    ScopeGuard,
    TenantGuard,
    {
      provide: APP_FILTER,
      useClass: JwtAuthExceptionFilter,
    },
    {
      provide: APP_FILTER,
      useClass: InsufficientScopeExceptionFilter,
    },
    {
      provide: APP_FILTER,
      useClass: TenantAccessDeniedExceptionFilter,
    },
  ],
  exports: [
    JwksCacheService,
    JwtValidationService,
    ScopeAuthorizationService,
    JwtGuard,
    ScopeGuard,
    TenantGuard,
  ],
})
export class AuthModule {}
