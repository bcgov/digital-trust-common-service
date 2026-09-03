import { shutdownTelemetry } from '@app/common/telemetry/tracing';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { ShutdownParticipant, ShutdownRegistry } from './shutdown-registry';

export const TELEMETRY_SHUTDOWN_TIMEOUT_MS = 5_000;

@Injectable()
export class TelemetryShutdownService
  implements ShutdownParticipant, OnModuleInit
{
  public readonly name = 'Telemetry';
  public readonly order = 0;

  private readonly logger = new Logger(TelemetryShutdownService.name);

  public constructor(private readonly shutdownRegistry: ShutdownRegistry) {}

  public onModuleInit(): void {
    this.shutdownRegistry.register(this);
  }

  public async shutdown(): Promise<void> {
    let timeout: NodeJS.Timeout | undefined;

    try {
      const timeoutPromise = new Promise<'timed-out'>((resolve) => {
        timeout = setTimeout(
          () => resolve('timed-out'),
          TELEMETRY_SHUTDOWN_TIMEOUT_MS,
        );
        timeout.unref();
      });

      const result = await Promise.race([shutdownTelemetry(), timeoutPromise]);

      if (result === 'timed-out') {
        this.logger.warn(
          `Telemetry shutdown timed out after ${TELEMETRY_SHUTDOWN_TIMEOUT_MS}ms; continuing shutdown`,
        );
      }
    } finally {
      // clearTimeout ignores undefined, so no guard is needed here.
      clearTimeout(timeout);
    }
  }
}
