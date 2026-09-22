import { Module } from '@nestjs/common';

import { TractionHttpClient } from './traction-http-client.service';
import { TractionTokenManager } from './traction-token-manager.service';
import { TractionWebhookRegistrar } from './traction-webhook-registrar.service';

/**
 * The Traction HTTP client, token cache, and webhook registrar, split out
 * from TractionModule so a feature outside the adapter graph (e.g.
 * ConnectorCredentialModule) can register a connector's webhook without
 * importing AdapterRegistryModule and creating
 * ConnectorCredentialModule -> TractionModule -> AdapterRegistryModule ->
 * ConnectorCredentialModule cycle.
 */
@Module({
  providers: [
    TractionHttpClient,
    TractionTokenManager,
    TractionWebhookRegistrar,
  ],
  exports: [TractionHttpClient, TractionTokenManager, TractionWebhookRegistrar],
})
export class TractionClientModule {}
