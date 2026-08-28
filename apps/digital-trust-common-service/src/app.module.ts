import { AuthModule } from '@app/auth';
import { DatabaseModule } from '@app/database';
import {
  OIDC_CLIENT_LOOKUP_PORT,
  OIDC_ROLE_SCOPE_PORT,
  OIDC_TENANT_USER_PORT,
  OIDC_UPSTREAM_FEDERATION_PORT,
  OidcModule,
} from '@app/oidc';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { AdapterRegistryModule } from './adapter-registry/adapter-registry.module';
import { AdminModule } from './admin/admin.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuditAutoInterceptor } from './audit-log/audit-auto.interceptor';
import { AuditLogModule } from './audit-log/audit-log.module';
import { AuthApiModule } from './auth/auth-api.module';
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
import { RoleScopeRepository } from './role-scope/role-scope.repository';
import { SeedModule } from './seed/seed.module';
import { ShutdownModule } from './shutdown/shutdown.module';
import { TenantStatusChangeModule } from './tenant/tenant-status-change.module';
import { TenantModule } from './tenant/tenant.module';
import { OidcTenantUserAdapter } from './tenant-user/oidc-tenant-user.adapter';
import { TenantUserModule } from './tenant-user/tenant-user.module';
import { OidcUpstreamFederationAdapter } from './upstream-oidc/oidc-upstream-federation.adapter';
import { UpstreamOidcModule } from './upstream-oidc/oidc-upstream.module';
import { VerificationProfileModule } from './verification-profile/verification-profile.module';

@Module({
  imports: [
    AdapterRegistryModule,
    AdminModule,
    AuditLogModule,
    AuthApiModule,
    ConfigModule.forRoot({ isGlobal: true }),
    ConnectionModule,
    ConnectorCredentialModule,
    CredentialDefinitionModule,
    CredentialModule,
    DatabaseModule,
    EncryptionModule,
    HealthModule,
    IssuanceProfileModule,
    JobsModule,
    OAuthClientModule,
    OidcModule.forRoot({
      imports: [
        OAuthClientModule,
        TenantUserModule,
        UpstreamOidcModule,
        RoleScopeModule,
      ],
      clientLookupProvider: {
        provide: OIDC_CLIENT_LOOKUP_PORT,
        useClass: OAuthClientLookupAdapter,
      },
      tenantUserProvider: {
        provide: OIDC_TENANT_USER_PORT,
        useClass: OidcTenantUserAdapter,
      },
      roleScopeProvider: {
        provide: OIDC_ROLE_SCOPE_PORT,
        useClass: RoleScopeRepository,
      },
      upstreamFederationProvider: {
        provide: OIDC_UPSTREAM_FEDERATION_PORT,
        useClass: OidcUpstreamFederationAdapter,
      },
    }),
    AuthModule,
    OperationModule,
    RoleScopeModule,
    ShutdownModule,
    TenantModule,
    TenantStatusChangeModule,
    TenantUserModule,
    UpstreamOidcModule,
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
