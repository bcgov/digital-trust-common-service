import { OidcConfigModule } from '@app/oidc';
import { Module } from '@nestjs/common';

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
