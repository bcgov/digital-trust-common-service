import { AuthModule } from '@app/auth';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLogModule } from '../audit-log/audit-log.module';

import { CredentialDefinitionController } from './credential-definition.controller';
import { CredentialDefinition } from './credential-definition.entity';
import { CredentialDefinitionRepository } from './credential-definition.repository';
import { CredentialDefinitionService } from './credential-definition.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([CredentialDefinition]),
    AuditLogModule,
    AuthModule,
  ],
  controllers: [CredentialDefinitionController],
  providers: [CredentialDefinitionService, CredentialDefinitionRepository],
  exports: [CredentialDefinitionService],
})
export class CredentialDefinitionModule {}
