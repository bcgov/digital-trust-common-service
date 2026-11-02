import { ConnectorType } from '../enums/connector-type.enum';

export type ConnectorHealthStatus = 'healthy' | 'unhealthy';

export interface ConnectorHealthCheckResult {
  status: ConnectorHealthStatus;
  latencyMs: number;
  message?: string;
  /**
   * The agent's own log identifier, as the connector type defines it. Only set
   * when the agent returned a usable one.
   */
  agentLogId?: string;
}

/**
 * Connectivity check for one connector type. Each probe owns how it reaches
 * its agent and where the agent log identifier comes from, keeping shared
 * code agent-agnostic.
 */
export interface ConnectorProbe {
  readonly connectorType: ConnectorType;
  check(
    endpointUrl: string,
    credentials: Readonly<Record<string, unknown>>,
  ): Promise<ConnectorHealthCheckResult>;
}

// Multi-provider injection token for the registered probes.
export const CONNECTOR_PROBES = Symbol('CONNECTOR_PROBES');
