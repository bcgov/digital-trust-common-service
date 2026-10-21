import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CredentialExchange } from '../credential-exchange/credential-exchange.entity';
import { CredentialExchangeRepository } from '../credential-exchange/credential-exchange.repository';

import { Credential } from './credential.entity';
import { CredentialRepository } from './credential.repository';

@Module({
  imports: [TypeOrmModule.forFeature([Credential, CredentialExchange])],
  providers: [CredentialRepository, CredentialExchangeRepository],
  exports: [CredentialRepository, CredentialExchangeRepository],
})
export class CredentialModule {}
