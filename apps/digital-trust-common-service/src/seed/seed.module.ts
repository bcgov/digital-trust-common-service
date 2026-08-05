import { DatabaseModule } from '@app/database';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EncryptionModule } from '../common/crypto/encryption.module';
import { ConnectionModule } from '../connection/connection.module';
import { ConnectorCredentialModule } from '../connector-credential/connector-credential.module';
import { CredentialDefinitionModule } from '../credential-definition/credential-definition.module';
import { IssuanceProfileModule } from '../issuance-profile/issuance-profile.module';
import { OAuthClientModule } from '../oauth-client/oauth-client.module';
import { Operation } from '../operation/operation.entity';
import { OperationRepository } from '../operation/operation.repository';
import { OperationService } from '../operation/operation.service';
import { TenantModule } from '../tenant/tenant.module';
import { TenantUserModule } from '../tenant-user/tenant-user.module';
import { VerificationProfileModule } from '../verification-profile/verification-profile.module';

import { DevSeedService } from './dev-seed.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    EncryptionModule,
    TenantModule,
    TenantUserModule,
    CredentialDefinitionModule,
    IssuanceProfileModule,
    VerificationProfileModule,
    ConnectionModule,
    ConnectorCredentialModule,
    OAuthClientModule,
    TypeOrmModule.forFeature([Operation]),
  ],
  providers: [DevSeedService, OperationRepository, OperationService],
  exports: [DevSeedService],
})
export class SeedModule {}
