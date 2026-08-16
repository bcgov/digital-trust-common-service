import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { parsePoolInt } from './pool.util';
import { buildSslConfig } from './ssl.util';

function buildPoolConfig(config: ConfigService): {
  max: number;
  min: number;
  idleTimeoutMillis: number;
} {
  const max = parsePoolInt(config, 'DB_POOL_MAX', 10, 1);
  // `min` is a "don't reap below" floor, not a pre-warm — pg-pool won't open
  // connections at boot, so `min` buys nothing until traffic has opened that
  // many. 0 is a valid floor (reap everything when idle).
  const min = parsePoolInt(config, 'DB_POOL_MIN', 2, 0);
  // 0 is an intentional escape hatch meaning "never reap idle clients"
  // (pg-pool semantics); at that setting a busy pod can pin up to `max`
  // connections indefinitely. Leave non-zero unless you deliberately want that.
  const idleTimeoutMillis = parsePoolInt(
    config,
    'DB_POOL_IDLE_TIMEOUT_MS',
    30000,
    0,
  );

  if (min > max) {
    throw new Error(
      `DB_POOL_MIN (${min}) must not exceed DB_POOL_MAX (${max}).`,
    );
  }

  return { max, min, idleTimeoutMillis };
}

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('DB_HOST', 'localhost'),
        port: parseInt(config.get<string>('DB_PORT', '5432'), 10),
        username: config.getOrThrow<string>('DB_USERNAME'),
        password: config.getOrThrow<string>('DB_PASSWORD'),
        database: config.getOrThrow<string>('DB_NAME'),
        autoLoadEntities: true,
        synchronize: false,
        migrationsRun: false,
        logging: config.get<string>('DB_LOGGING') === 'true',
        // Bound the node-postgres pool explicitly (driver default is 10).
        // This is not a pod's whole connection budget: pg-boss opens a second,
        // independent pool of its own (PGBOSS_POOL_MAX, see PgBossService), so
        // size a pod as DB_POOL_MAX + PGBOSS_POOL_MAX.
        // Deployed pods connect direct to Crunchy `-primary` (not pgBouncer),
        // so the ceiling is Postgres `max_connections`. See issue #156.
        extra: buildPoolConfig(config),
        ssl: buildSslConfig(
          config.get<string>('DB_SSL'),
          config.get<string>('DB_SSL_REJECT_UNAUTHORIZED'),
          config.get<string>('DB_SSL_CA'),
        ),
      }),
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {}
