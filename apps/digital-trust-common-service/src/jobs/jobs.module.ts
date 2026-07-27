import { PgBossModule } from '@app/pg-boss';
import { Global, Module } from '@nestjs/common';

import { ShutdownModule } from '../shutdown/shutdown.module';

import { JobsService } from './jobs.service';

@Global()
@Module({
  imports: [PgBossModule, ShutdownModule],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
