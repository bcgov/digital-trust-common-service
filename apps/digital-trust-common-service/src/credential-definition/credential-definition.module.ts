import { AuthModule } from '@app/auth';
import { CredentialPortsModule } from '@app/credential-ports';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdapterRegistryModule } from '../adapter-registry/adapter-registry.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { JobsModule } from '../jobs/jobs.module';
import { OperationModule } from '../operation/operation.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { TenantStatusModule } from '../tenant/tenant-status.module';

import { CredentialDefinitionRegistrationWorker } from './credential-definition-registration.worker';
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
    CredentialPortsModule,
    RateLimitModule,
    AdapterRegistryModule,
    OperationModule,
    JobsModule,
  ],
  controllers: [CredentialDefinitionController],
  providers: [
    CredentialDefinitionService,
    CredentialDefinitionRepository,
    CredentialDefinitionRegistrationWorker,
  ],
  exports: [CredentialDefinitionService, CredentialDefinitionRepository],
})
export class CredentialDefinitionModule {}
