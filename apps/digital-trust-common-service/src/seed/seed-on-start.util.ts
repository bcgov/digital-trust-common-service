import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const logger = new Logger('DevSeed');

/**
 * Returns true when development seed should run during app bootstrap.
 * Requires SEED_ON_START=true and refuses production unless SEED_ALLOW_PRODUCTION=true.
 */
export function shouldRunDevSeedOnStart(config: ConfigService): boolean {
  if (config.get<string>('SEED_ON_START') !== 'true') {
    return false;
  }

  const nodeEnv = config.get<string>('NODE_ENV', 'development');

  if (nodeEnv === 'production') {
    if (config.get<string>('SEED_ALLOW_PRODUCTION') === 'true') {
      logger.warn(
        'SEED_ON_START is enabled in production because SEED_ALLOW_PRODUCTION=true.',
      );
      return true;
    }

    logger.warn(
      'Skipping development seed: SEED_ON_START=true is not allowed when NODE_ENV=production (set SEED_ALLOW_PRODUCTION=true to override).',
    );
    return false;
  }

  return true;
}
