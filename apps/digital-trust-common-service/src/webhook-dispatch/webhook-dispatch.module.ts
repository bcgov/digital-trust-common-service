import { Module } from '@nestjs/common';

import { WebhookDispatchWorker } from './webhook-dispatch.worker';

@Module({
  providers: [WebhookDispatchWorker],
  exports: [WebhookDispatchWorker],
})
export class WebhookDispatchModule {}
