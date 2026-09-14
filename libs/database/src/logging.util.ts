import { ConfigService } from '@nestjs/config';
import { LoggerOptions } from 'typeorm';

/**
 * TypeORM log levels accepted in `DB_LOGGING`, matching its own `LogLevel`
 * union. `query` is the noisy one: it logs every statement, including the
 * readiness probe's `SELECT 1` every few seconds.
 */
const LOG_LEVELS = [
  'query',
  'schema',
  'error',
  'warn',
  'info',
  'log',
  'migration',
] as const;

type LogLevel = (typeof LOG_LEVELS)[number];

function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/**
 * Parse `DB_LOGGING` into TypeORM's `logging` option.
 *
 * `true` means every statement, which in a deployed environment is
 * overwhelmingly the readiness probe: a sample of the dev pod's stream in Loki
 * was 214 `query: SELECT 1` lines out of 300. Those lines are also not JSON, so
 * they defeat log parsing as well as burying everything else.
 *
 * Accepting a level list lets an environment keep the useful halves — failed
 * statements and migrations — without the per-query flood. `true` and `false`
 * keep working as before.
 *
 * @throws if a named level is not one TypeORM understands, rather than silently
 * dropping it and leaving an operator to wonder why nothing is logged.
 */
export function parseDbLogging(config: ConfigService): LoggerOptions {
  const raw = config.get<string>('DB_LOGGING');

  if (raw === undefined || raw.trim() === '' || raw.trim() === 'false') {
    return false;
  }

  const value = raw.trim();

  if (value === 'true' || value === 'all') {
    return true;
  }

  const requested = value
    .split(',')
    .map((level) => level.trim())
    .filter((level) => level !== '');

  const unknown = requested.filter((level) => !isLogLevel(level));

  if (unknown.length > 0) {
    throw new Error(
      `DB_LOGGING contains unknown level(s) ${unknown.join(', ')}. ` +
        `Use "true", "false", or a comma-separated list of: ${LOG_LEVELS.join(', ')}.`,
    );
  }

  return requested as LogLevel[];
}
