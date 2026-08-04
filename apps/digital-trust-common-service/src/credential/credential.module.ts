import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Credential } from './credential.entity';
import { CredentialRepository } from './credential.repository';

@Module({
  imports: [TypeOrmModule.forFeature([Credential])],
  providers: [CredentialRepository],
  exports: [CredentialRepository],
})
export class CredentialModule {}
