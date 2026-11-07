import { Injectable, Logger } from '@nestjs/common';

import { buildAgentPartitionKey } from '../common/agent-log-partition-key';
import { EncryptionService } from '../common/crypto/encryption.service';
import { ConnectorRepository } from '../connector/connector.repository';

import type { AgentLogPartitionResolverPort } from './agent-log-partition-resolver.port';
import { AgentLogPartitionCache } from './agent-log-partition.cache';

/**
 * Forward-only lookup of a tenant's agent partitions from its active
 * connectors. Any datastore, decryption or
 * malformed-identifier failure throws so the request is denied; it never
 * degrades to the tenant partition alone.
 */
@Injectable()
export class ConnectorAgentLogPartitionResolver implements AgentLogPartitionResolverPort {
  private readonly logger = new Logger(ConnectorAgentLogPartitionResolver.name);

  public constructor(
    private readonly connectors: ConnectorRepository,
    private readonly encryption: EncryptionService,
    private readonly cache: AgentLogPartitionCache,
  ) {}

  public async resolveAgentPartitions(tenantId: string): Promise<string[]> {
    const cached = this.cache.get(tenantId);

    if (cached) {
      return cached;
    }

    const lookup = this.cache.beginLookup();
    const credentials = await this.connectors.findByTenant(tenantId);
    const partitions: string[] = [];

    for (const credential of credentials) {
      if (!credential.active) {
        continue;
      }

      const decrypted = this.encryption.decrypt<unknown>(
        credential.credentialsEncrypted,
        credential.keyVersion,
      );

      if (
        typeof decrypted !== 'object' ||
        decrypted === null ||
        Array.isArray(decrypted)
      ) {
        throw new Error(
          `Connector ${credential.id} has an unexpected decrypted credentials shape.`,
        );
      }

      const { agentLogId } = decrypted as { agentLogId?: unknown };

      if (agentLogId === undefined) {
        this.logger.warn(
          `Active connector ${credential.id} of tenant ${tenantId} has no agent log identifier; its agent logs are not exposed.`,
        );
        continue;
      }

      if (typeof agentLogId !== 'string') {
        throw new Error(
          `Connector ${credential.id} has a malformed agent log identifier.`,
        );
      }

      partitions.push(
        buildAgentPartitionKey(credential.connectorType, agentLogId),
      );
    }

    this.cache.set(tenantId, partitions, lookup);

    return partitions;
  }
}
