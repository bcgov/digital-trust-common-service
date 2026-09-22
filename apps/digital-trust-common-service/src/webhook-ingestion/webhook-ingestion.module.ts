import { Module } from '@nestjs/common';

import { EncryptionModule } from '../common/crypto/encryption.module';
import { ConnectorCredentialModule } from '../connector-credential/connector-credential.module';
import { ProtocolStateChangeModule } from '../protocol-state-change/protocol-state-change.module';

import { ConnectorWebhookController } from './connector-webhook.controller';
import { ConnectorWebhookGuard } from './connector-webhook.guard';

@Module({
  imports: [
    ConnectorCredentialModule,
    EncryptionModule,
    ProtocolStateChangeModule,
  ],
  controllers: [ConnectorWebhookController],
  providers: [ConnectorWebhookGuard],
  exports: [ConnectorWebhookGuard],
})
export class WebhookIngestionModule {}
