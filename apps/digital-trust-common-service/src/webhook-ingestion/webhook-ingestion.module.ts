import { Module } from '@nestjs/common';

import { EncryptionModule } from '../common/crypto/encryption.module';
import { ConnectorModule } from '../connector/connector.module';
import { ProtocolStateChangeModule } from '../protocol-state-change/protocol-state-change.module';

import { ConnectorWebhookGuard } from './connector-webhook.guard';
import { TractionWebhookController } from './traction-webhook.controller';

@Module({
  imports: [ConnectorModule, EncryptionModule, ProtocolStateChangeModule],
  controllers: [TractionWebhookController],
  providers: [ConnectorWebhookGuard],
  exports: [ConnectorWebhookGuard],
})
export class WebhookIngestionModule {}
