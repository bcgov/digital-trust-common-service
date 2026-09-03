import { AuthModule } from '@app/auth';
import { CredentialPortsModule } from '@app/credential-ports';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogModule } from '../audit-log/audit-log.module';
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
    CredentialPortsModule,
  ],
  controllers: [CredentialDefinitionController],
  providers: [CredentialDefinitionService, CredentialDefinitionRepository],
  exports: [CredentialDefinitionService],
})
export class CredentialDefinitionModule {}
