import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RateLimitHit } from './rate-limit-hit.entity';
import { RateLimitHitRepository } from './rate-limit-hit.repository';
import { RateLimitStorageService } from './rate-limit-storage.service';

/**
 * Split out from `RateLimitModule` so `RateLimitStorageService` can be
 * listed in `ThrottlerModule.forRootAsync`'s own `imports`: a dynamic
 * module's async factory can only inject providers exported by modules in
 * its own `imports` array, not sibling providers declared on the module
 * that imports it.
 */
@Module({
  imports: [TypeOrmModule.forFeature([RateLimitHit])],
  providers: [RateLimitHitRepository, RateLimitStorageService],
  exports: [RateLimitHitRepository, RateLimitStorageService],
})
export class RateLimitStorageModule {}
