import { AuthModule } from '@app/auth';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogModule } from '../audit-log/audit-log.module';
import { TenantUserModule } from '../tenant-user/tenant-user.module';

import { TenantStatusModule } from './tenant-status.module';
import { TenantController } from './tenant.controller';
import { Tenant } from './tenant.entity';
import { TenantRepository } from './tenant.repository';
import { TenantService } from './tenant.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Tenant]),
    AuditLogModule,
    AuthModule,
    TenantUserModule,
    TenantStatusModule,
  ],
  controllers: [TenantController],
  providers: [TenantService, TenantRepository],
  exports: [TenantService],
})
export class TenantModule {}
