import { CredentialPortsModule } from '@app/credential-ports';
import { Module } from '@nestjs/common';

import { ConnectorCredentialModule } from '../connector-credential/connector-credential.module';
import { TenantModule } from '../tenant/tenant.module';

import { AdapterRegistry } from './adapter-registry.service';

/**
 * Hosts the AdapterRegistry. Adapter modules (CT-01 onwards) import this module
 * and call `register()` at startup; consumers inject `AdapterRegistry` to
 * resolve the adapter for a tenant.
 */
@Module({
  imports: [CredentialPortsModule, TenantModule, ConnectorCredentialModule],
  providers: [AdapterRegistry],
  exports: [AdapterRegistry],
})
export class AdapterRegistryModule {}
