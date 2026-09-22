import { Module } from '@nestjs/common';

import { AdapterRegistryModule } from '../adapter-registry/adapter-registry.module';

import { TractionClientModule } from './traction-client.module';
import { TractionAdapter } from './traction.adapter';

/**
 * Registers the Traction AgentAdapter with the AdapterRegistry at startup.
 * See AdapterRegistryModule for the registration contract adapter modules
 * follow. Re-exports the whole TractionClientModule (rather than just the
 * TractionWebhookRegistrar token) since Nest only allows re-exporting a
 * provider a module didn't declare itself by re-exporting the module that
 * provides it.
 */
@Module({
  imports: [AdapterRegistryModule, TractionClientModule],
  providers: [TractionAdapter],
  exports: [TractionAdapter, TractionClientModule],
})
export class TractionModule {}
