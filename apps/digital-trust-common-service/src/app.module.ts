import { DatabaseModule } from '@app/database';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AdminModule } from './admin/admin.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuditLogModule } from './audit-log/audit-log.module';
import { EncryptionModule } from './common/crypto/encryption.module';
import { ConnectionModule } from './connection/connection.module';
import { ConnectorCredentialModule } from './connector-credential/connector-credential.module';
import { CredentialDefinitionModule } from './credential-definition/credential-definition.module';
import { HealthModule } from './health/health.module';
import { IssuanceProfileModule } from './issuance-profile/issuance-profile.module';
import { JobsModule } from './jobs/jobs.module';
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
    JobsModule,
    AdminModule,
    AuditLogModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
