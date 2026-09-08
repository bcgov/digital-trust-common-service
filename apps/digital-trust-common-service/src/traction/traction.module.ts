import { Module } from '@nestjs/common';

import { AdapterRegistryModule } from '../adapter-registry/adapter-registry.module';

import { TractionHttpClient } from './traction-http-client.service';
import { TractionAdapter } from './traction.adapter';

/**
 * Registers the Traction AgentAdapter with the AdapterRegistry at startup.
 * See AdapterRegistryModule for the registration contract adapter modules
 * follow.
 */
@Module({
  imports: [AdapterRegistryModule],
  providers: [TractionAdapter, TractionHttpClient],
  exports: [TractionAdapter],
})
export class TractionModule {}
