import { PgBossService } from '@app/pg-boss';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import {
  ShutdownRegistry,
  ShutdownParticipant,
} from '../shutdown/shutdown-registry';

@Injectable()
export class JobsService implements ShutdownParticipant, OnModuleInit {
  private readonly logger = new Logger(JobsService.name);
  public readonly name = 'JobsService';
  public readonly order = 1;

  public constructor(
    private readonly bossService: PgBossService,
    private readonly shutdownRegistry: ShutdownRegistry,
  ) {}

  public onModuleInit(): void {
    this.shutdownRegistry.register(this);
  }

  public publish(name: string, data: object | null): Promise<string | null> {
    return this.bossService.boss.send(name, data);
  }

  public async shutdown(): Promise<void> {
    this.logger.log('Stopping jobs service...');
    await this.bossService.boss.stop();
    this.logger.log('Jobs service stopped');
  }
}
