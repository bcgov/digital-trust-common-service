import { Global, Module } from '@nestjs/common';

import { ShutdownRegistry } from './shutdown-registry';
import { GracefulShutdownService } from './shutdown.service';

@Global()
@Module({
  providers: [ShutdownRegistry, GracefulShutdownService],
  exports: [ShutdownRegistry, GracefulShutdownService],
})
export class ShutdownModule {}
