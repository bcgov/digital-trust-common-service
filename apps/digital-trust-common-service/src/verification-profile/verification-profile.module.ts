import { AuthModule } from '@app/auth';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogModule } from '../audit-log/audit-log.module';
import { IssuanceProfileModule } from '../issuance-profile/issuance-profile.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { TenantStatusModule } from '../tenant/tenant-status.module';

import { VerificationProfileController } from './verification-profile.controller';
import { VerificationProfile } from './verification-profile.entity';
import { VerificationProfileRepository } from './verification-profile.repository';
import { VerificationProfileService } from './verification-profile.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([VerificationProfile]),
    AuditLogModule,
    AuthModule,
    IssuanceProfileModule,
    TenantStatusModule,
    RateLimitModule,
  ],
  controllers: [VerificationProfileController],
  providers: [VerificationProfileService, VerificationProfileRepository],
  exports: [VerificationProfileRepository, VerificationProfileService],
})
export class VerificationProfileModule {}
