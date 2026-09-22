import { Module } from '@nestjs/common';

import { BusinessMetricsService } from './business-metrics.service';
import { TransactionalMetricsSubscriber } from './transactional-metrics.subscriber';

/**
 * Hosts the business metric counters. Imported by the feature modules that
 * record them — OperationModule for credential outcomes, AdapterRegistryModule
 * for adapter calls — so the counters stay a single instance per process
 * rather than one per consumer.
 */
@Module({
  providers: [BusinessMetricsService, TransactionalMetricsSubscriber],
  exports: [BusinessMetricsService],
})
export class BusinessMetricsModule {}
