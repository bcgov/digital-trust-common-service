import { AuthModule } from '@app/auth';
import { Module } from '@nestjs/common';

import { OperationModule } from '../operation/operation.module';

import { AdminOperationsController } from './admin-operations.controller';
import { AdminOperationsService } from './admin-operations.service';

@Module({
  imports: [AuthModule, OperationModule],
  controllers: [AdminOperationsController],
  providers: [AdminOperationsService],
})
export class AdminModule {}
