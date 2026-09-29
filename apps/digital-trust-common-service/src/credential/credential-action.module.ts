import { AuthModule } from '@app/auth';
import { CredentialPortsModule } from '@app/credential-ports';
import { Module } from '@nestjs/common';

import { AdapterRegistryModule } from '../adapter-registry/adapter-registry.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CredentialDefinitionModule } from '../credential-definition/credential-definition.module';
import { IssuanceProfileModule } from '../issuance-profile/issuance-profile.module';
import { OperationModule } from '../operation/operation.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { TenantStatusModule } from '../tenant/tenant-status.module';

import { CredentialActionController } from './credential-action.controller';
import { CredentialActionService } from './credential-action.service';
import { CredentialOfferController } from './credential-offer.controller';
import { CredentialOfferService } from './credential-offer.service';
import { CredentialRevokeController } from './credential-revoke.controller';
import { CredentialRevokeService } from './credential-revoke.service';
import { CredentialModule } from './credential.module';

/**
 * Hosts the holder accept/reject endpoints, the issuer offer endpoint, and
 * the issuer revocation endpoint. Deliberately separate from the bare
 * `CredentialModule`: `AdapterRegistryModule -> ConnectorCredentialModule ->
 * CredentialModule` already forms a chain, so importing `AdapterRegistryModule`
 * directly into `CredentialModule` would create a cycle. This module sits
 * alongside both, importing `CredentialModule` (for `CredentialRepository`,
 * used by the offer/revocation endpoints) and `AdapterRegistryModule`
 * without either importing back into it. `IssuanceProfileModule` and
 * `CredentialDefinitionModule` have no dependency back on this module either,
 * so importing them here for the offer endpoint carries no cycle risk.
 */
@Module({
  imports: [
    AdapterRegistryModule,
    AuditLogModule,
    AuthModule,
    CredentialDefinitionModule,
    CredentialModule,
    CredentialPortsModule,
    IssuanceProfileModule,
    OperationModule,
    TenantStatusModule,
    RateLimitModule,
  ],
  controllers: [
    CredentialActionController,
    CredentialOfferController,
    CredentialRevokeController,
  ],
  providers: [
    CredentialActionService,
    CredentialOfferService,
    CredentialRevokeService,
  ],
})
export class CredentialActionModule {}
