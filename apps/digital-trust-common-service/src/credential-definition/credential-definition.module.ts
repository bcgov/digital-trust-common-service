import { AuthModule } from '@app/auth';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogModule } from '../audit-log/audit-log.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { TenantStatusModule } from '../tenant/tenant-status.module';

import { CredentialDefinitionController } from './credential-definition.controller';
import { CredentialDefinition } from './credential-definition.entity';
import { CredentialDefinitionRepository } from './credential-definition.repository';
import { CredentialDefinitionService } from './credential-definition.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([CredentialDefinition]),
    AuditLogModule,
    AuthModule,
    TenantStatusModule,
    RateLimitModule,
  ],
  controllers: [CredentialDefinitionController],
  providers: [CredentialDefinitionService, CredentialDefinitionRepository],
  exports: [CredentialDefinitionService],
})
export class CredentialDefinitionModule {}
