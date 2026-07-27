import { DatabaseModule } from '@app/database';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConnectionModule } from './connection/connection.module';
import { CredentialDefinitionModule } from './credential-definition/credential-definition.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { OperationModule } from './operation/operation.module';
import { ShutdownModule } from './shutdown/shutdown.module';
import { TenantModule } from './tenant/tenant.module';
import { TenantUserModule } from './tenant-user/tenant-user.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    HealthModule,
    ShutdownModule,
    TenantModule,
    TenantUserModule,
    CredentialDefinitionModule,
    ConnectionModule,
    OperationModule,
    JobsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
