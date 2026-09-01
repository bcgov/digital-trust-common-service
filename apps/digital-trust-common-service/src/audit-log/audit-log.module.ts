import { AuthModule } from '@app/auth';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TenantStatusModule } from '../tenant/tenant-status.module';

import { AuditLogController } from './audit-log.controller';
import { AuditLog } from './audit-log.entity';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogService } from './audit-log.service';
import { AuditPartitionWorker } from './audit-partition.worker';
import { AuditWriteWorker } from './audit-write.worker';
import { DomainAuditService } from './domain-audit.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog]),
    AuthModule,
    TenantStatusModule,
  ],
  controllers: [AuditLogController],
  providers: [
    AuditLogService,
    AuditLogRepository,
    AuditWriteWorker,
    AuditPartitionWorker,
    DomainAuditService,
  ],
  exports: [AuditLogService, AuditWriteWorker, DomainAuditService],
})
export class AuditLogModule {}
