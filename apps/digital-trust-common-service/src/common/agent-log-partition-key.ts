/**
 * Loki partition key for an agent's own log lines. Ingestion and the log
 * gateway must both derive the key through this function so the two sides
 * cannot disagree about which partition holds a tenant's agent logs.
 *
 * The agent log identifier is taken as emitted, lowercase and hyphenated,
 * with no case-folding or trimming. Anything else is rejected rather than
 * normalised, so a value containing `|`, a path character, or whitespace can
 * never widen a read scope or collide with another partition namespace.
 */
export const AGENT_PARTITION_KEY_PREFIX = 'a-';

const AGENT_LOG_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isValidAgentLogId(value: unknown): value is string {
  return typeof value === 'string' && AGENT_LOG_ID_PATTERN.test(value);
}

export function buildAgentPartitionKey(agentLogId: string): string {
  if (!isValidAgentLogId(agentLogId)) {
    throw new Error('Agent log identifier is not a canonical lowercase UUID.');
  }

  return `${AGENT_PARTITION_KEY_PREFIX}${agentLogId}`;
}
