import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import { TenantStatusModule } from '../tenant/tenant-status.module';

import { RateLimitPruneWorker } from './rate-limit-prune.worker';
import { RateLimitStorageModule } from './rate-limit-storage.module';
import { RateLimitStorageService } from './rate-limit-storage.service';
import { RateLimitGuard } from './rate-limit.guard';
import { TenantTierRateLimitGuard } from './tenant-tier-rate-limit.guard';

@Module({
  imports: [
    RateLimitStorageModule,
    TenantStatusModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule, RateLimitStorageModule],
      inject: [RateLimitStorageService, ConfigService],
      useFactory: (
        storage: RateLimitStorageService,
        config: ConfigService,
      ) => ({
        storage,
        throttlers: [
          {
            name: 'default',
            ttl: Number(config.get<string>('RATE_LIMIT_WINDOW_MS', '60000')),
            limit: Number(
              config.get<string>('RATE_LIMIT_STANDARD_PER_MINUTE', '100'),
            ),
          },
        ],
      }),
    }),
  ],
  providers: [
    RateLimitPruneWorker,
    TenantTierRateLimitGuard,
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  // Re-exports RateLimitStorageModule rather than just
  // RateLimitHitRepository: Nest can only export a provider that is in
  // this module's own `providers` array, or a whole imported module —
  // RateLimitHitRepository lives in RateLimitStorageModule (see its own
  // doc comment for why). TenantTierRateLimitGuard is exported directly
  // so feature modules can import RateLimitModule and reference the guard
  // in their controllers' `@UseGuards()`.
  exports: [RateLimitStorageModule, TenantTierRateLimitGuard],
})
export class RateLimitModule {}
