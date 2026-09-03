import { AuthModule } from '@app/auth';
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogModule } from '../audit-log/audit-log.module';
import { ConnectorCredentialModule } from '../connector-credential/connector-credential.module';
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
    forwardRef(() => ConnectorCredentialModule),
  ],
  controllers: [TenantController],
  providers: [TenantService, TenantRepository],
  exports: [TenantService, TenantRepository],
})
export class TenantModule {}
