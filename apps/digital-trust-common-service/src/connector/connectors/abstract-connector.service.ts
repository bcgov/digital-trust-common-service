import type { ConnectorContext } from '@app/credential-ports';

import { ConnectorType } from '../../connection/connection.entity';
import { ConnectorDto } from '../dto/create-connector.dto';

export const CONNECTOR_MANAGERS = Symbol('CONNECTOR_MANAGERS');

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

export abstract class AbstractConnector {
  public abstract readonly connectorType: ConnectorType;

  public abstract check(
    endpointUrl: string,
    credentials: Readonly<Record<string, unknown>>,
  ): Promise<ConnectorHealthCheckResult>;

  public abstract prepareCredentials(credentials: ConnectorDto): void;

  public abstract mergeCredentials(
    existing: ConnectorDto,
    updates: Partial<ConnectorDto>,
  ): ConnectorDto;

  public abstract ensureWebhookRegistered(
    context: ConnectorContext,
  ): Promise<void>;

  public abstract isWebhookRegistered(
    context: ConnectorContext,
  ): Promise<boolean>;

  public abstract evict(connectorId: string): void;
}

export type ConnectorManagers = Readonly<
  Partial<Record<ConnectorType, AbstractConnector>>
>;
