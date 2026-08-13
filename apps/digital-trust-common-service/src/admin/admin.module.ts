import { AuthModule } from '@app/auth';
import { OidcAccountSessionModule } from '@app/oidc/sessions';
import { Module } from '@nestjs/common';

import { AuditLogModule } from '../audit-log/audit-log.module';
import { OperationModule } from '../operation/operation.module';
import { TenantUserModule } from '../tenant-user/tenant-user.module';

import { AdminOperationsController } from './admin-operations.controller';
import { AdminOperationsService } from './admin-operations.service';
import { AdminSessionsController } from './admin-sessions.controller';
import { AdminSessionsService } from './admin-sessions.service';

@Module({
  imports: [
    AuthModule,
    OperationModule,
    TenantUserModule,
    OidcAccountSessionModule,
    AuditLogModule,
  ],
  controllers: [AdminOperationsController, AdminSessionsController],
  providers: [AdminOperationsService, AdminSessionsService],
})
export class AdminModule {}
