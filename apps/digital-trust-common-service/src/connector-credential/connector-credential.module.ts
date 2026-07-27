import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EncryptionModule } from '../common/crypto/encryption.module';

import { ConnectorCredentialController } from './connector-credential.controller';
import { ConnectorCredential } from './connector-credential.entity';
import { ConnectorCredentialRepository } from './connector-credential.repository';
import { ConnectorCredentialService } from './connector-credential.service';

@Module({
  imports: [TypeOrmModule.forFeature([ConnectorCredential]), EncryptionModule],
  controllers: [ConnectorCredentialController],
  providers: [ConnectorCredentialService, ConnectorCredentialRepository],
  exports: [ConnectorCredentialService],
})
export class ConnectorCredentialModule {}
