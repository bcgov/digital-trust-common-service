import { OidcConfigModule } from '@app/oidc/config';
import { Module } from '@nestjs/common';

import { TractionConnector } from './traction-connector.service';
import { TractionHttpClient } from './traction-http-client.service';
import { TractionTokenManager } from './traction-token-manager.service';
import { TractionWebhookRegistrar } from './traction-webhook-registrar.service';

@Module({
  imports: [OidcConfigModule],
  providers: [
    TractionHttpClient,
    TractionTokenManager,
    TractionWebhookRegistrar,
    TractionConnector,
  ],
  exports: [TractionConnector, TractionHttpClient, TractionTokenManager],
})
export class TractionConnectorModule {}
