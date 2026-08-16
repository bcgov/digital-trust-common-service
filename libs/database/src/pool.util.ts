import { ConfigService } from '@nestjs/config';

/**
 * Shared by every pool this service opens against Postgres: TypeORM's
 * (DatabaseModule) and pg-boss's own (PgBossService). Both count against the
 * same `max_connections` budget, so both parse their bounds the same way.
 */
export function parsePoolInt(
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
