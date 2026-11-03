/**
 * Resolves the agent-side partition keys for a tenant's active connectors
 * Implementations return already-derived keys, never raw
 * agent identifiers, and throw on any resolution failure so the caller can
 * fail closed.
 */
export interface AgentLogPartitionResolverPort {
  resolveAgentPartitions(tenantId: string): Promise<string[]>;
}
