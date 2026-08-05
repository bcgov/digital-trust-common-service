import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogModule } from '../audit-log/audit-log.module';

import { TenantUserController } from './tenant-user.controller';
import { TenantUser } from './tenant-user.entity';
import { TenantUserRepository } from './tenant-user.repository';
import { TenantUserService } from './tenant-user.service';

@Module({
  imports: [TypeOrmModule.forFeature([TenantUser]), AuditLogModule],
  controllers: [TenantUserController],
  providers: [TenantUserService, TenantUserRepository],
  exports: [TenantUserService],
})
export class TenantUserModule {}
