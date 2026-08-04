import { DatabaseModule } from '@app/database';
import { OIDC_CLIENT_LOOKUP_PORT, OidcModule } from '@app/oidc';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AdminModule } from './admin/admin.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuditLogModule } from './audit-log/audit-log.module';
import { EncryptionModule } from './common/crypto/encryption.module';
import { ConnectionModule } from './connection/connection.module';
import { ConnectorCredentialModule } from './connector-credential/connector-credential.module';
import { CredentialModule } from './credential/credential.module';
import { CredentialDefinitionModule } from './credential-definition/credential-definition.module';
import { HealthModule } from './health/health.module';
import { IssuanceProfileModule } from './issuance-profile/issuance-profile.module';
import { JobsModule } from './jobs/jobs.module';
import { OAuthClientLookupAdapter } from './oauth-client/oauth-client-lookup.adapter';
import { OAuthClientModule } from './oauth-client/oauth-client.module';
import { OperationModule } from './operation/operation.module';
import { ShutdownModule } from './shutdown/shutdown.module';
import { TenantModule } from './tenant/tenant.module';
import { TenantUserModule } from './tenant-user/tenant-user.module';
import { VerificationProfileModule } from './verification-profile/verification-profile.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    EncryptionModule,
    HealthModule,
    JobsModule,
    OAuthClientModule,
    OidcModule.forRoot({
      imports: [OAuthClientModule],
      clientLookupProvider: {
        provide: OIDC_CLIENT_LOOKUP_PORT,
        useClass: OAuthClientLookupAdapter,
      },
    }),
    OperationModule,
    JobsModule,
    OAuthClientModule,
    OperationModule,
    ShutdownModule,
    TenantModule,
    TenantUserModule,
    CredentialDefinitionModule,
    IssuanceProfileModule,
    VerificationProfileModule,
    ConnectionModule,
    ConnectorCredentialModule,
    OAuthClientModule,
    OperationModule,
    CredentialModule,
    JobsModule,
    AdminModule,
    AuditLogModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
