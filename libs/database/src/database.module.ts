import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { buildSslConfig } from './ssl.util';

function parsePoolInt(
  config: ConfigService,
  key: string,
  fallback: number,
  min: number,
): number {
  const raw = config.get<string>(key);

  if (raw === undefined || raw === '') {
    return fallback;
  }

  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`${key} must be a non-negative integer, got "${raw}".`);
  }

  const value = parseInt(raw, 10);

  if (value < min) {
    throw new Error(`${key} must be >= ${min}, got ${value}.`);
  }

  return value;
}

function buildPoolConfig(config: ConfigService): {
  max: number;
  min: number;
  idleTimeoutMillis: number;
} {
  const max = parsePoolInt(config, 'DB_POOL_MAX', 10, 1);
  const min = parsePoolInt(config, 'DB_POOL_MIN', 2, 0);
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
