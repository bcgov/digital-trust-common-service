import { parseArgs } from 'node:util';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { BootstrapModule } from './bootstrap.module';
import { EnvironmentBootstrapService } from './bootstrap.service';

const USAGE =
  'Usage: run-bootstrap --tenant-slug <slug> --tenant-name <name> [--rotate-admin-secret]';
// As CreateTenantDto, so the API can address the tenant afterwards.
const SLUG_PATTERN = /^[a-z0-9-]{1,100}$/;
const NAME_MAX_LENGTH = 255;

export async function runBootstrap(
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const logger = new Logger('BootstrapCLI');
  const { values } = parseArgs({
    args: argv,
    options: {
      'tenant-slug': { type: 'string' },
      'tenant-name': { type: 'string' },
      'rotate-admin-secret': { type: 'boolean', default: false },
    },
  });
  const slug = values['tenant-slug'] ?? '';
  const name = values['tenant-name'] ?? '';

  // No defaults: nobody bootstraps an environment with a placeholder by accident.
  if (!SLUG_PATTERN.test(slug) || !name || name.length > NAME_MAX_LENGTH) {
    logger.error(
      `${USAGE}\n  slug: lowercase letters, digits and hyphens, at most 100; name: 1-${NAME_MAX_LENGTH} characters`,
    );
    process.exitCode = 2;
    return;
  }

  const app = await NestFactory.createApplicationContext(BootstrapModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const result = await app
      .get(EnvironmentBootstrapService)
      .run(slug, name, values['rotate-admin-secret']);

    logger.log(`Tenant ${slug}: ${result.tenantId}`);
    logger.log(`UI client redirect URIs: ${result.redirectUris.join(', ')}`);

    if (result.adminClientSecret) {
      // To the operator's terminal only — never through the logger, whose
      // output may be shipped and retained.
      process.stdout.write(
        `Platform-admin client secret (shown once; keep it with the environment's secrets):\n${result.adminClientSecret}\n`,
      );
    } else {
      logger.log(
        'Platform-admin client already present; re-run with --rotate-admin-secret to mint a new secret.',
      );
    }
  } catch (error) {
    logger.error(
      'Bootstrap failed',
      error instanceof Error ? error.stack : String(error),
    );
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

const entryScript = process.argv[1]?.replace(/\\/g, '/');

if (
  entryScript?.endsWith('run-bootstrap.js') ||
  entryScript?.endsWith('run-bootstrap.ts')
) {
  void runBootstrap();
}
