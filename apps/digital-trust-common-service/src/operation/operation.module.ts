import { AuthModule } from '@app/auth';
import { PgBossModule } from '@app/pg-boss';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { TenantStatusModule } from '../tenant/tenant-status.module';
import { TenantModule } from '../tenant/tenant.module';

import { OperationPurgeService } from './operation-purge.service';
import { OperationController } from './operation.controller';
import { Operation } from './operation.entity';
import { OperationRepository } from './operation.repository';
import { OperationService } from './operation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Operation]),
    TenantModule,
    PgBossModule,
    AuthModule,
    TenantStatusModule,
    RateLimitModule,
  ],
  controllers: [OperationController],
  providers: [OperationService, OperationRepository, OperationPurgeService],
  exports: [OperationService, OperationRepository],
})
export class OperationModule {}
