import { AuthModule } from '@app/auth';
import { OidcConfigModule } from '@app/oidc/config';
import { OidcAccountSessionModule } from '@app/oidc/sessions';
import { Module } from '@nestjs/common';

import { AuditLogModule } from '../audit-log/audit-log.module';
import { RoleScopeModule } from '../role-scope/role-scope.module';
import { TenantStatusModule } from '../tenant/tenant-status.module';
import { TenantUserModule } from '../tenant-user/tenant-user.module';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    AuthModule,
    TenantUserModule,
    TenantStatusModule,
    RoleScopeModule,
    AuditLogModule,
    OidcConfigModule,
    OidcAccountSessionModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthApiModule {}
