import { Module } from '@nestjs/common';

import { AgentLogPartitionCache } from './agent-log-partition.cache';

/**
 * Standalone so the connector module can invalidate the cache without
 * depending on the log access module.
 */
@Module({
  providers: [AgentLogPartitionCache],
  exports: [AgentLogPartitionCache],
})
export class AgentLogPartitionCacheModule {}
