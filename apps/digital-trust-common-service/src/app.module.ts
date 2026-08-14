import { AuthModule } from '@app/auth';
import { DatabaseModule } from '@app/database';
import { OIDC_CLIENT_LOOKUP_PORT, OidcModule } from '@app/oidc';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { AdminModule } from './admin/admin.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuditAutoInterceptor } from './audit-log/audit-auto.interceptor';
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
import { RoleScopeModule } from './role-scope/role-scope.module';
import { SeedModule } from './seed/seed.module';
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
    AuthModule,
    OperationModule,
    RoleScopeModule,
    ShutdownModule,
    TenantModule,
    TenantUserModule,
    CredentialDefinitionModule,
    IssuanceProfileModule,
    VerificationProfileModule,
    ConnectionModule,
    ConnectorCredentialModule,
    CredentialModule,
    AdminModule,
    AuditLogModule,
    SeedModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditAutoInterceptor,
    },
  ],
})
export class AppModule {}
