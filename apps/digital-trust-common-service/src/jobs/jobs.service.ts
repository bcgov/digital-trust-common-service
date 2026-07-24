import { PgBossService } from '@app/pg-boss';
import { QUEUE_DEFINITIONS, fromTypeOrm } from '@app/pg-boss';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Job, WorkHandler, WorkOptions } from 'pg-boss';
import type { EntityManager } from 'typeorm';

import {
  ShutdownRegistry,
  ShutdownParticipant,
} from '../shutdown/shutdown-registry';

export type RegisterWorkerOptions = WorkOptions & {
  /** When false, skip attaching a worker (API-only pods). Default true. */
  enabled?: boolean;
};

@Injectable()
export class JobsService implements ShutdownParticipant, OnModuleInit {
  private readonly logger = new Logger(JobsService.name);
  public readonly name = 'JobsService';
  public readonly order = 1;

  private queuesReady = false;
  private ensureQueuesPromise: Promise<void> | null = null;

  public constructor(
    private readonly bossService: PgBossService,
    private readonly shutdownRegistry: ShutdownRegistry,
    private readonly config: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  public async onModuleInit(): Promise<void> {
    this.shutdownRegistry.register(this);
    await this.ensureQueues();
    this.eventEmitter.emit('jobs.queues.ready');
  }

  public async ensureQueues(): Promise<void> {
    if (this.queuesReady) {
      return;
    }

    if (!this.ensureQueuesPromise) {
      this.ensureQueuesPromise = this.createQueuesOnce();
    }

    await this.ensureQueuesPromise;
  }

  private async createQueuesOnce(): Promise<void> {
    for (const definition of QUEUE_DEFINITIONS) {
      await this.bossService.boss.createQueue(definition.deadLetter);
      await this.bossService.boss.createQueue(definition.name, {
        retryLimit: definition.retryLimit,
        retryDelay: definition.retryDelay,
        retryBackoff: definition.retryBackoff,
        deadLetter: definition.deadLetter,
      });
      this.logger.log(`Ensured queue ${definition.name}`);
    }

    this.queuesReady = true;
  }

  public publish(name: string, data: object | null): Promise<string | null> {
    return this.bossService.boss.send(name, data);
  }

  /**
   * Enqueue a job using the same DB transaction as the caller's EntityManager.
   */
  public async sendInTransaction(
    manager: EntityManager,
    queueName: string,
    data: object | null,
  ): Promise<string | null> {
    return this.bossService.boss.send(queueName, data, {
      db: fromTypeOrm(manager),
    });
  }

  public defaultWorkOptions(): WorkOptions {
    const nodeEnv = this.config.get<string>('NODE_ENV', 'development');
    const pollingDefault = nodeEnv === 'production' ? 1 : 2;
    const pollingIntervalSeconds = Number(
      this.config.get<string>(
        'PG_BOSS_POLLING_INTERVAL_SECONDS',
        String(pollingDefault),
      ),
    );
    const localConcurrency = Number(
      this.config.get<string>('PG_BOSS_LOCAL_CONCURRENCY', '2'),
    );

    return {
      pollingIntervalSeconds,
      localConcurrency,
      batchSize: 1,
    };
  }

  /**
   * Register a pg-boss worker for a queue. Domain modules call this from
   * OnModuleInit after queues are ensured.
   */
  public async registerWorker<T extends object>(
    queueName: string,
    handler: (job: Job<T>) => Promise<void>,
    options: RegisterWorkerOptions = {},
  ): Promise<string | null> {
    const { enabled = true, ...workOptions } = options;
    if (!enabled) {
      this.logger.log(`Skipping worker registration for ${queueName}`);
      return null;
    }

    await this.ensureQueues();

    const merged: WorkOptions = {
      ...this.defaultWorkOptions(),
      ...workOptions,
    };

    const workHandler: WorkHandler<T> = async (jobs) => {
      for (const job of jobs) {
        await handler(job);
      }
    };

    const workerId = await this.bossService.boss.work(
      queueName,
      merged,
      workHandler,
    );
    this.logger.log(`Registered worker for ${queueName} (${workerId})`);
    return workerId;
  }

  public async shutdown(): Promise<void> {
    this.logger.log('Stopping jobs service...');
    await this.bossService.boss.stop();
    this.logger.log('Jobs service stopped');
  }
}
