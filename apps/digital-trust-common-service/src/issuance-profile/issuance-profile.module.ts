import { AuthModule } from '@app/auth';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdapterRegistryModule } from '../adapter-registry/adapter-registry.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CredentialDefinitionModule } from '../credential-definition/credential-definition.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { TenantStatusModule } from '../tenant/tenant-status.module';

import { IssuanceProfileController } from './issuance-profile.controller';
import { IssuanceProfile } from './issuance-profile.entity';
import { IssuanceProfileRepository } from './issuance-profile.repository';
import { IssuanceProfileService } from './issuance-profile.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([IssuanceProfile]),
    AdapterRegistryModule,
    AuditLogModule,
    AuthModule,
    CredentialDefinitionModule,
    TenantStatusModule,
    RateLimitModule,
  ],
  controllers: [IssuanceProfileController],
  providers: [IssuanceProfileService, IssuanceProfileRepository],
  exports: [IssuanceProfileRepository, IssuanceProfileService],
})
export class IssuanceProfileModule {}
