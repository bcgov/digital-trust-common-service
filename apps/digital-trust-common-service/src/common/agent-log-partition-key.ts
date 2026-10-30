import { ConnectorType } from '../connection/connection.entity';

/**
 * Loki partition key for an agent's own log lines. Ingestion and the log
 * gateway must both derive the key through this module so the two sides
 * cannot disagree about which partition holds a tenant's agent logs.
 *
 * The identifier's source and format are defined per connector type; shared
 * code only requires that it is safe to embed in a Loki label value. Anything
 * else is rejected rather than normalised, so a value containing `|`, a path
 * character, or whitespace can never widen a read scope or collide with
 * another partition namespace.
 */
export const AGENT_PARTITION_KEY_PREFIX = 'a-';

const AGENT_LOG_ID_PATTERN = /^[A-Za-z0-9-]{1,100}$/;

export function isValidAgentLogId(value: unknown): value is string {
  return typeof value === 'string' && AGENT_LOG_ID_PATTERN.test(value);
}

/**
 * The canonical `(connectorType, agentLogId)` pairing. The uniqueness hash and
 * the partition key both derive from this pair, so they cannot drift apart.
 */
export function formatAgentLogBindingKey(
  connectorType: ConnectorType,
  agentLogId: string,
): string {
  if (!(Object.values(ConnectorType) as string[]).includes(connectorType)) {
    throw new Error('Connector type is not recognised.');
  }

  if (!isValidAgentLogId(agentLogId)) {
    throw new Error('Agent log identifier is not Loki-safe.');
  }

  return `${connectorType}:${agentLogId}`;
}

export function buildAgentPartitionKey(
  connectorType: ConnectorType,
  agentLogId: string,
): string {
  formatAgentLogBindingKey(connectorType, agentLogId);

  return `${AGENT_PARTITION_KEY_PREFIX}${connectorType}-${agentLogId}`;
}
