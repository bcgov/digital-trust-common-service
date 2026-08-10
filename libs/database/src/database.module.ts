import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { buildSslConfig } from './ssl.util';

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
        // Bound the node-postgres pool explicitly instead of relying on the
        // driver default of 10. Deployed environments connect directly to the
        // Crunchy `-primary` service (not pgBouncer), so the ceiling is
        // Postgres' `max_connections`; size the per-pod pool against the HPA
        // replica ceiling, the worker, and the migration Job. See issue #156.
        extra: {
          max: parseInt(config.get<string>('DB_POOL_MAX', '10'), 10),
          min: parseInt(config.get<string>('DB_POOL_MIN', '2'), 10),
          idleTimeoutMillis: parseInt(
            config.get<string>('DB_POOL_IDLE_TIMEOUT_MS', '30000'),
            10,
          ),
        },
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
