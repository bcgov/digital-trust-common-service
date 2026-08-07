import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { DevSeedService } from './dev-seed.service';
import { SeedModule } from './seed.module';

export async function runSeed(): Promise<void> {
  const logger = new Logger('SeedCLI');
  const app = await NestFactory.createApplicationContext(SeedModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    await app.get(DevSeedService).run();
  } catch (error) {
    logger.error(
      'Seed failed',
      error instanceof Error ? error.stack : String(error),
    );
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

const entryScript = process.argv[1]?.replace(/\\/g, '/');

if (
  entryScript?.endsWith('run-seed.js') ||
  entryScript?.endsWith('run-seed.ts')
) {
  void runSeed();
}
