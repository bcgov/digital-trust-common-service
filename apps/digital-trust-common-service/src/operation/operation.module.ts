import { PgBossModule } from '@app/pg-boss';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TenantModule } from '../tenant/tenant.module';

import { OperationPurgeService } from './operation-purge.service';
import { OperationController } from './operation.controller';
import { Operation } from './operation.entity';
import { OperationRepository } from './operation.repository';
import { OperationService } from './operation.service';

@Module({
  imports: [TypeOrmModule.forFeature([Operation]), TenantModule, PgBossModule],
  controllers: [OperationController],
  providers: [OperationService, OperationRepository, OperationPurgeService],
  exports: [OperationService, OperationRepository],
})
export class OperationModule {}
