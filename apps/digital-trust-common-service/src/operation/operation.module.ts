import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Operation } from './operation.entity';
import { OperationRepository } from './operation.repository';
import { OperationService } from './operation.service';

@Module({
  imports: [TypeOrmModule.forFeature([Operation])],
  providers: [OperationService, OperationRepository],
  exports: [OperationService, OperationRepository],
})
export class OperationModule {}
