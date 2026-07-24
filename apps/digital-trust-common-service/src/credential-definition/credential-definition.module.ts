import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CredentialDefinitionController } from './credential-definition.controller';
import { CredentialDefinition } from './credential-definition.entity';
import { CredentialDefinitionRepository } from './credential-definition.repository';
import { CredentialDefinitionService } from './credential-definition.service';

@Module({
  imports: [TypeOrmModule.forFeature([CredentialDefinition])],
  controllers: [CredentialDefinitionController],
  providers: [CredentialDefinitionService, CredentialDefinitionRepository],
  exports: [CredentialDefinitionService],
})
export class CredentialDefinitionModule {}
