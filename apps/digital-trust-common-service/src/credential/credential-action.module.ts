import { AuthModule } from '@app/auth';
import { Module } from '@nestjs/common';

import { AdapterRegistryModule } from '../adapter-registry/adapter-registry.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { OperationModule } from '../operation/operation.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { TenantStatusModule } from '../tenant/tenant-status.module';

import { CredentialActionController } from './credential-action.controller';
import { CredentialActionService } from './credential-action.service';
import { CredentialRevokeController } from './credential-revoke.controller';
import { CredentialRevokeService } from './credential-revoke.service';
import { CredentialModule } from './credential.module';

/**
 * Hosts the holder accept/reject endpoints and the issuer revocation
 * endpoint. Deliberately separate from the bare `CredentialModule`:
 * `AdapterRegistryModule -> ConnectorCredentialModule -> CredentialModule`
 * already forms a chain, so importing `AdapterRegistryModule` directly into
 * `CredentialModule` would create a cycle. This module sits alongside both,
 * importing `CredentialModule` (for `CredentialRepository`, used by the
 * revocation endpoint) and `AdapterRegistryModule` without either importing
 * back into it.
 */
@Module({
  imports: [
    AdapterRegistryModule,
    AuditLogModule,
    AuthModule,
    CredentialModule,
    OperationModule,
    TenantStatusModule,
    RateLimitModule,
  ],
  controllers: [CredentialActionController, CredentialRevokeController],
  providers: [CredentialActionService, CredentialRevokeService],
})
export class CredentialActionModule {}
