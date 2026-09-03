import { AuthModule } from '@app/auth';
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EncryptionModule } from '../common/crypto/encryption.module';
import { CredentialModule } from '../credential/credential.module';
import { TenantStatusModule } from '../tenant/tenant-status.module';
import { TenantModule } from '../tenant/tenant.module';

import { ConnectorCredentialController } from './connector-credential.controller';
import { ConnectorCredential } from './connector-credential.entity';
import { ConnectorCredentialRepository } from './connector-credential.repository';
import { ConnectorCredentialService } from './connector-credential.service';
import { ConnectorHealthCheckService } from './connector-health-check.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConnectorCredential]),
    EncryptionModule,
    forwardRef(() => TenantModule),
    AuthModule,
    TenantStatusModule,
    CredentialModule,
  ],
  controllers: [ConnectorCredentialController],
  providers: [
    ConnectorCredentialService,
    ConnectorCredentialRepository,
    ConnectorHealthCheckService,
  ],
  exports: [ConnectorCredentialService],
})
export class ConnectorCredentialModule {}
