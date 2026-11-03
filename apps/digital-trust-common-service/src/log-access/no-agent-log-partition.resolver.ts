import { Injectable } from '@nestjs/common';

import type { AgentLogPartitionResolverPort } from './agent-log-partition-resolver.port';

/**
 * Placeholder until agent identifier resolution lands: a tenant is scoped to
 * this service's own partition only.
 */
@Injectable()
export class NoAgentLogPartitionResolver implements AgentLogPartitionResolverPort {
  public resolveAgentPartitions(): Promise<string[]> {
    return Promise.resolve([]);
  }
}
