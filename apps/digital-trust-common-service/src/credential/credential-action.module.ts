import { AuthModule } from '@app/auth';
import { Module } from '@nestjs/common';

import { AdapterRegistryModule } from '../adapter-registry/adapter-registry.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { OperationModule } from '../operation/operation.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { TenantStatusModule } from '../tenant/tenant-status.module';

import { CredentialActionController } from './credential-action.controller';
import { CredentialActionService } from './credential-action.service';

/**
 * Hosts the CA-05 holder accept/reject endpoints. Deliberately separate from
 * `CredentialModule`: this feature only ever touches the `Operation` entity
 * (see `CredentialActionService`), not the `Credential` entity, and importing
 * `AdapterRegistryModule` here would otherwise create a module import cycle
 * through `AdapterRegistryModule -> ConnectorCredentialModule ->
 * CredentialModule`.
 */
@Module({
  imports: [
    AdapterRegistryModule,
    AuditLogModule,
    AuthModule,
    OperationModule,
    TenantStatusModule,
    RateLimitModule,
  ],
  controllers: [CredentialActionController],
  providers: [CredentialActionService],
})
export class CredentialActionModule {}
