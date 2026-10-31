import { AuthModule } from '@app/auth';
import { CredentialPortsModule } from '@app/credential-ports';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdapterRegistryModule } from '../adapter-registry/adapter-registry.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { ConnectorCredentialModule } from '../connector-credential/connector-credential.module';
import { JobsModule } from '../jobs/jobs.module';
import { OperationModule } from '../operation/operation.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { TenantStatusModule } from '../tenant/tenant-status.module';

import { AnonCredsCredentialDefinitionFormatHandler } from './anoncreds-credential-definition-format.handler';
import { AnonCredsCredentialDefinitionRegistrationWorker } from './anoncreds-credential-definition-registration.worker';
import { CREDENTIAL_DEFINITION_FORMAT_HANDLERS } from './credential-definition-format-handler';
import { CredentialDefinitionController } from './credential-definition.controller';
import { CredentialDefinition } from './credential-definition.entity';
import { CredentialDefinitionRepository } from './credential-definition.repository';
import { CredentialDefinitionService } from './credential-definition.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([CredentialDefinition]),
    AuditLogModule,
    ConnectorCredentialModule,
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
    AnonCredsCredentialDefinitionRegistrationWorker,
    AnonCredsCredentialDefinitionFormatHandler,
    {
      provide: CREDENTIAL_DEFINITION_FORMAT_HANDLERS,
      useFactory: (anonCreds: AnonCredsCredentialDefinitionFormatHandler) => [
        anonCreds,
      ],
      inject: [AnonCredsCredentialDefinitionFormatHandler],
    },
  ],
  exports: [CredentialDefinitionService, CredentialDefinitionRepository],
})
export class CredentialDefinitionModule {}
