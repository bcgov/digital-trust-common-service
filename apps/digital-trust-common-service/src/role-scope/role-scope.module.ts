import { AuthModule } from '@app/auth';
import { OidcAccountSessionModule } from '@app/oidc/sessions';
import { Module } from '@nestjs/common';

import { AuditLogModule } from '../audit-log/audit-log.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { TenantStatusModule } from '../tenant/tenant-status.module';

import { RoleScopeRepository } from './role-scope.repository';
import { RoleScopeService } from './role-scope.service';
import { RoleController } from './role.controller';
import { ScopeController } from './scope.controller';
import { TenantRoleScopeController } from './tenant-role-scope.controller';

/**
 * Role→scope lookups used when issuing user tokens, plus the AU-07 (#40)
 * scope catalog and per-tenant override API.
 */
@Module({
  imports: [
    AuthModule,
    OidcAccountSessionModule,
    AuditLogModule,
    TenantStatusModule,
    RateLimitModule,
  ],
  controllers: [ScopeController, RoleController, TenantRoleScopeController],
  providers: [RoleScopeRepository, RoleScopeService],
  exports: [RoleScopeRepository, RoleScopeService],
})
export class RoleScopeModule {}
