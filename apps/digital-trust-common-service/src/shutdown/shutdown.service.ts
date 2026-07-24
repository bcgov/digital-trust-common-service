import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';

import { ShutdownRegistry } from './shutdown-registry';

@Injectable()
export class GracefulShutdownService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(GracefulShutdownService.name);
  private isShuttingDown = false;

  public constructor(private readonly registry: ShutdownRegistry) {}

  public async beforeApplicationShutdown(signal?: string) {
    this.isShuttingDown = true;
    const participants = this.registry.getParticipants();

    for (const participant of participants) {
      this.logger.log(`Shutting down ${participant.name}...`);

      try {
        await participant.shutdown(signal);
      } catch (error) {
        this.logger.error(
          `${participant.name} failed to shut down`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    this.isShuttingDown = false;
  }

  public isInShutdown(): boolean {
    return this.isShuttingDown;
  }
}
