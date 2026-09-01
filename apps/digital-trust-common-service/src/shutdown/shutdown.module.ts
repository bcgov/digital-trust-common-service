import { Global, Module } from '@nestjs/common';

import { ShutdownRegistry } from './shutdown-registry';
import { GracefulShutdownService } from './shutdown.service';
import { TelemetryShutdownService } from './telemetry-shutdown.service';

@Global()
@Module({
  providers: [
    ShutdownRegistry,
    GracefulShutdownService,
    TelemetryShutdownService,
  ],
  exports: [ShutdownRegistry, GracefulShutdownService],
})
export class ShutdownModule {}
