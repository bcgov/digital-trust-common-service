import { AuthModule } from '@app/auth';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogModule } from '../audit-log/audit-log.module';
import { OperationModule } from '../operation/operation.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { TenantStatusModule } from '../tenant/tenant-status.module';

import { PresentationDefinitionController } from './presentation-definition.controller';
import { PresentationDefinition } from './presentation-definition.entity';
import { PresentationDefinitionRepository } from './presentation-definition.repository';
import { VerificationProfileController } from './verification-profile.controller';
import { VerificationProfile } from './verification-profile.entity';
import { VerificationProfileRepository } from './verification-profile.repository';
import { VerificationProfileService } from './verification-profile.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([VerificationProfile, PresentationDefinition]),
    AuditLogModule,
    OperationModule,
    AuthModule,
    TenantStatusModule,
    RateLimitModule,
  ],
  controllers: [
    VerificationProfileController,
    PresentationDefinitionController,
  ],
  providers: [
    VerificationProfileService,
    VerificationProfileRepository,
    PresentationDefinitionRepository,
  ],
  exports: [
    VerificationProfileRepository,
    VerificationProfileService,
    PresentationDefinitionRepository,
  ],
})
export class VerificationProfileModule {}
