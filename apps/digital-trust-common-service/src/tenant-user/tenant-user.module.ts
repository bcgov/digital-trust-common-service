import { AuthModule } from '@app/auth';
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogModule } from '../audit-log/audit-log.module';
import { TenantStatusModule } from '../tenant/tenant-status.module';
import { TenantModule } from '../tenant/tenant.module';

import { OidcTenantUserAdapter } from './oidc-tenant-user.adapter';
import { TenantMembershipGuard } from './tenant-membership.guard';
import { TenantUserController } from './tenant-user.controller';
import { TenantUser } from './tenant-user.entity';
import { TenantUserRepository } from './tenant-user.repository';
import { TenantUserService } from './tenant-user.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TenantUser]),
    AuditLogModule,
    AuthModule,
    forwardRef(() => TenantModule),
    TenantStatusModule,
  ],
  controllers: [TenantUserController],
  providers: [
    TenantUserService,
    TenantUserRepository,
    OidcTenantUserAdapter,
    TenantMembershipGuard,
  ],
  exports: [TenantUserService, OidcTenantUserAdapter],
})
export class TenantUserModule {}
