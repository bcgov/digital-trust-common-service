import { parsePoolInt } from '@app/database/pool.util';
import { buildSslConfig } from '@app/database/ssl.util';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PgBoss } from 'pg-boss';

@Injectable()
export class PgBossService {
  private readonly logger = new Logger(PgBossService.name);

  public boss!: PgBoss;

  private readonly maxRetries = 5;

  private readonly retryDelayMs = 1000;

  public constructor(private readonly config: ConfigService) {}

  /**
   * Split from `createBoss` so the connection options — the pool bound in
   * particular — stay unit-testable: pg-boss is ESM-only, so the dynamic
   * import below cannot run under the unit jest config.
   */
  public buildBossOptions(): ConstructorParameters<typeof PgBoss>[0] {
    return {
      host: this.config.get<string>('DB_HOST', 'localhost'),
      port: parseInt(this.config.get<string>('DB_PORT', '5432'), 10),
      database: this.config.getOrThrow<string>('DB_NAME'),
      user: this.config.getOrThrow<string>('DB_USERNAME'),
      password: this.config.getOrThrow<string>('DB_PASSWORD'),
      // pg-boss builds its own pg.Pool rather than sharing TypeORM's, and
      // defaults to 10. Left unbounded it doubles a pod's real connection
      // count against `max_connections` (see DatabaseModule's sizing note).
      max: parsePoolInt(this.config, 'PGBOSS_POOL_MAX', 5, 1),
      ssl: buildSslConfig(
        this.config.get<string>('DB_SSL'),
        this.config.get<string>('DB_SSL_REJECT_UNAUTHORIZED'),
        this.config.get<string>('DB_SSL_CA'),
      ),
    };
  }

  public async createBoss(): Promise<PgBoss> {
    const { PgBoss } = await import('pg-boss');

    return new PgBoss(this.buildBossOptions());
  }

  public async initializeBoss(): Promise<PgBoss> {
    const boss = await this.createBoss();
    this.boss = boss;
    this.logger.log('Starting pg-boss...');

    await this.startWithRetry(boss);

    this.logger.log('pg-boss started');
    return boss;
  }

  private async startWithRetry(boss: PgBoss, attempt = 1): Promise<void> {
    try {
      await boss.start();
    } catch (error) {
      if (attempt <= this.maxRetries) {
        const delayMs = this.retryDelayMs * Math.pow(2, attempt - 1);
        this.logger.warn(
          `Failed to start pg-boss (attempt ${attempt}/${this.maxRetries}). Retrying in ${delayMs}ms...`,
          error instanceof Error ? error.message : String(error),
        );
        await this.delay(delayMs);
        return this.startWithRetry(boss, attempt + 1);
      }

      this.logger.error(
        `Failed to start pg-boss after ${this.maxRetries} attempts`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
