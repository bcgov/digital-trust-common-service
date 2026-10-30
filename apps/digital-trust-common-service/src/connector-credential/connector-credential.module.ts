import { AuthModule } from '@app/auth';
import { CONNECTOR_PROBES } from '@app/credential-ports';
import { OidcConfigModule } from '@app/oidc/config';
import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EncryptionModule } from '../common/crypto/encryption.module';
import { CredentialModule } from '../credential/credential.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { TenantStatusModule } from '../tenant/tenant-status.module';
import { TenantModule } from '../tenant/tenant.module';
import { TractionClientModule } from '../traction/traction-client.module';
import { TractionConnectorProbe } from '../traction/traction-connector.probe';

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
    RateLimitModule,
    TractionClientModule,
    OidcConfigModule,
  ],
  controllers: [ConnectorCredentialController],
  providers: [
    ConnectorCredentialService,
    ConnectorCredentialRepository,
    ConnectorHealthCheckService,
    {
      provide: CONNECTOR_PROBES,
      useFactory: (traction: TractionConnectorProbe) => [traction],
      inject: [TractionConnectorProbe],
    },
  ],
  exports: [ConnectorCredentialService],
})
export class ConnectorCredentialModule {}
