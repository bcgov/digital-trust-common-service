import { shutdownTelemetry } from '@app/common/telemetry/tracing';
import { Injectable, OnModuleInit } from '@nestjs/common';

import { ShutdownParticipant, ShutdownRegistry } from './shutdown-registry';

@Injectable()
export class TelemetryShutdownService
  implements ShutdownParticipant, OnModuleInit
{
  public readonly name = 'Telemetry';
  public readonly order = 0;

  public constructor(private readonly shutdownRegistry: ShutdownRegistry) {}

  public onModuleInit(): void {
    this.shutdownRegistry.register(this);
  }

  public shutdown(): Promise<void> {
    return shutdownTelemetry();
  }
}
