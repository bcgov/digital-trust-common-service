import { AuthModule } from '@app/auth';
import { OidcAccountSessionModule } from '@app/oidc/sessions';
import { Module } from '@nestjs/common';

import { AuditLogModule } from '../audit-log/audit-log.module';
import { OperationModule } from '../operation/operation.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { TenantModule } from '../tenant/tenant.module';
import { TenantUserModule } from '../tenant-user/tenant-user.module';

import { AdminOperationsController } from './admin-operations.controller';
import { AdminOperationsService } from './admin-operations.service';
import { AdminRateLimitController } from './admin-rate-limit.controller';
import { AdminRateLimitService } from './admin-rate-limit.service';
import { AdminSessionsController } from './admin-sessions.controller';
import { AdminSessionsService } from './admin-sessions.service';

@Module({
  imports: [
    AuthModule,
    OperationModule,
    RateLimitModule,
    TenantModule,
    TenantUserModule,
    OidcAccountSessionModule,
    AuditLogModule,
  ],
  controllers: [
    AdminOperationsController,
    AdminRateLimitController,
    AdminSessionsController,
  ],
  providers: [
    AdminOperationsService,
    AdminRateLimitService,
    AdminSessionsService,
  ],
})
export class AdminModule {}
