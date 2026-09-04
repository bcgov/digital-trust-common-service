import { ExecutionContext, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import { TenantStatusModule } from '../tenant/tenant-status.module';
import { TenantRepository } from '../tenant/tenant.repository';

import { RATE_LIMIT_BY_CALLER_KEY } from './rate-limit-by-caller.decorator';
import { RateLimitPruneWorker } from './rate-limit-prune.worker';
import { RateLimitStorageModule } from './rate-limit-storage.module';
import { RateLimitStorageService } from './rate-limit-storage.service';
import { resolveRateLimitTier } from './rate-limit-tier';
import { TenantRateLimitGuard } from './tenant-rate-limit.guard';

function extractTenantId(
  context: ExecutionContext,
  reflector: Reflector,
): string | undefined {
  const byCaller = reflector.getAllAndOverride<boolean>(
    RATE_LIMIT_BY_CALLER_KEY,
    [context.getHandler(), context.getClass()],
  );

  if (byCaller) {
    return undefined;
  }

  const req = context
    .switchToHttp()
    .getRequest<{ params?: Record<string, string> }>();

  return req.params?.tenantId;
}

@Module({
  imports: [
    RateLimitStorageModule,
    TenantStatusModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule, TenantStatusModule, RateLimitStorageModule],
      inject: [
        RateLimitStorageService,
        TenantRepository,
        ConfigService,
        Reflector,
      ],
      useFactory: (
        storage: RateLimitStorageService,
        tenants: TenantRepository,
        config: ConfigService,
        reflector: Reflector,
      ) => ({
        storage,
        throttlers: [
          {
            name: 'default',
            ttl: Number(config.get<string>('RATE_LIMIT_WINDOW_MS', '60000')),
            limit: async (context: ExecutionContext): Promise<number> => {
              const standardLimit = Number(
                config.get<string>('RATE_LIMIT_STANDARD_PER_MINUTE', '100'),
              );
              const tenantId = extractTenantId(context, reflector);

              if (!tenantId) {
                return standardLimit;
              }

              const premiumLimit = Number(
                config.get<string>('RATE_LIMIT_PREMIUM_PER_MINUTE', '1000'),
              );
              const tenant = await tenants.findById(tenantId);
              const tier = resolveRateLimitTier(tenant?.config);

              return tier === 'premium' ? premiumLimit : standardLimit;
            },
          },
        ],
      }),
    }),
  ],
  providers: [
    RateLimitPruneWorker,
    { provide: APP_GUARD, useClass: TenantRateLimitGuard },
  ],
  // Re-exports the whole module rather than just RateLimitHitRepository:
  // Nest can only export a provider that is in this module's own
  // `providers` array, or a whole imported module — RateLimitHitRepository
  // now lives in RateLimitStorageModule (see its own doc comment for why).
  exports: [RateLimitStorageModule],
})
export class RateLimitModule {}
