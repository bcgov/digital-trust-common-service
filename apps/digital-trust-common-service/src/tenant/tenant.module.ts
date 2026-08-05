import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogModule } from '../audit-log/audit-log.module';

import { TenantController } from './tenant.controller';
import { Tenant } from './tenant.entity';
import { TenantRepository } from './tenant.repository';
import { TenantService } from './tenant.service';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant]), AuditLogModule],
  controllers: [TenantController],
  providers: [TenantService, TenantRepository],
  exports: [TenantService],
})
export class TenantModule {}
