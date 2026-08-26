import { AuthModule } from '@app/auth';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TenantStatusGuard } from './tenant-status.guard';
import { Tenant } from './tenant.entity';
import { TenantRepository } from './tenant.repository';

/**
 * Split out from `TenantModule` so `TenantStatusGuard` can be shared with
 * modules that `TenantModule` itself imports (e.g. `TenantUserModule`)
 * without a circular module dependency.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Tenant]), AuthModule],
  providers: [TenantRepository, TenantStatusGuard],
  exports: [TenantRepository, TenantStatusGuard],
})
export class TenantStatusModule {}
