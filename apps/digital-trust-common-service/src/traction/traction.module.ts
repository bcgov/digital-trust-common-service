import { Module } from '@nestjs/common';

import { AdapterRegistryModule } from '../adapter-registry/adapter-registry.module';

import { TractionAdapter } from './traction.adapter';

/**
 * Registers the Traction AgentAdapter with the AdapterRegistry at startup.
 * See AdapterRegistryModule for the registration contract adapter modules
 * follow.
 */
@Module({
  imports: [AdapterRegistryModule],
  providers: [TractionAdapter],
  exports: [TractionAdapter],
})
export class TractionModule {}
