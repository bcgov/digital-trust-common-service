import { CredentialPortsModule } from '@app/credential-ports';
import { Module } from '@nestjs/common';

import { EncryptionModule } from '../common/crypto/encryption.module';
import { BusinessMetricsModule } from '../common/telemetry/business-metrics.module';
import { ConnectorModule } from '../connector/connector.module';
import { TractionDefinitionRegistration } from '../connector/connectors/traction/traction-definition-registration.service';
import { TenantModule } from '../tenant/tenant.module';

import { AdapterRegistry } from './adapter-registry.service';
import { TractionAdapter } from './adapters/traction.adapter';

/**
 * Hosts the AdapterRegistry. Adapter modules import this module and call
 * `register()` at startup; consumers inject `AdapterRegistry` to resolve the
 * adapter for a tenant.
 */
@Module({
  imports: [
    CredentialPortsModule,
    TenantModule,
    ConnectorModule,
    EncryptionModule,
    BusinessMetricsModule,
  ],
  providers: [AdapterRegistry, TractionAdapter, TractionDefinitionRegistration],
  exports: [AdapterRegistry],
})
export class AdapterRegistryModule {}
