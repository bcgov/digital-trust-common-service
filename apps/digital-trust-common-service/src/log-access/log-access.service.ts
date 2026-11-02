import { Inject, Injectable, Logger } from '@nestjs/common';

import type { AgentLogPartitionResolverPort } from './agent-log-partition-resolver.port';
import { LogAccessDeniedError } from './log-access-denied.error';
import { LogAccessTokenService } from './log-access-token.service';
import {
  AGENT_LOG_PARTITION_RESOLVER,
  MAX_PARTITIONS_PER_SCOPE,
} from './log-access.constants';
import {
  deriveTenantPartitionKey,
  isSafePartitionKey,
} from './log-partition-key';

/**
 * Turns a presented token into the partition scope for the Loki read path:
 * the tenant's own partition plus one per resolved agent partition (Rules
 * G1, G3). The scope derives only from the validated token and the
 * resolution, never from the request.
 */
@Injectable()
export class LogAccessService {
  private readonly logger = new Logger(LogAccessService.name);

  public constructor(
    private readonly tokens: LogAccessTokenService,
    @Inject(AGENT_LOG_PARTITION_RESOLVER)
    private readonly resolver: AgentLogPartitionResolverPort,
  ) {}

  public async resolveScope(
    authorizationHeader: string | undefined,
  ): Promise<string> {
    const { tenantId } = await this.tokens.authorize(authorizationHeader);

    let agentPartitions: string[];

    try {
      agentPartitions = await this.resolver.resolveAgentPartitions(tenantId);
    } catch (error) {
      this.logger.error(
        `Agent partition resolution failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      throw new LogAccessDeniedError(403, 'resolution_failed');
    }

    // An unusable key denies the whole request rather than being dropped (M14).
    if (!agentPartitions.every(isSafePartitionKey)) {
      throw new LogAccessDeniedError(403, 'resolution_failed');
    }

    const partitions = [
      deriveTenantPartitionKey(tenantId),
      ...new Set(agentPartitions),
    ];

    // Rule M17: deny rather than silently truncate.
    if (partitions.length > MAX_PARTITIONS_PER_SCOPE) {
      throw new LogAccessDeniedError(403, 'partition_bound_exceeded');
    }

    return partitions.join('|');
  }
}
