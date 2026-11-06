import { Inject, Injectable, Logger } from '@nestjs/common';

import { isValidAgentLogId } from '../common/agent-log-partition-key';
import { ConnectorType } from '../connection/connection.entity';

import {
  CONNECTOR_MANAGERS,
  type ConnectorHealthCheckResult,
  type ConnectorManagers,
} from './connectors/abstract-connector.service';
import { ConnectorDto } from './dto/create-connector.dto';

/**
 * Health-checks a tenant's backend agent endpoint. Connector types with a
 * registered ConnectorManager are dispatched to it; any other type is reported
 * unhealthy until a manager is registered.
 */
@Injectable()
export class ConnectorHealthCheckService {
  private readonly logger = new Logger(ConnectorHealthCheckService.name);

  public constructor(
    @Inject(CONNECTOR_MANAGERS)
    private readonly managers: ConnectorManagers,
  ) {}

  public async check(
    connectorType: ConnectorType,
    endpointUrl: string,
    credentials: ConnectorDto,
  ): Promise<ConnectorHealthCheckResult> {
    const manager = this.managers[connectorType];

    if (manager) {
      const result = await manager.check(endpointUrl, { ...credentials });

      if (
        result.agentLogId !== undefined &&
        !isValidAgentLogId(result.agentLogId)
      ) {
        this.logger.warn(
          'Connector manager returned an unusable agent log identifier; discarding it.',
        );
        delete result.agentLogId;
      }

      return result;
    }

    return {
      status: 'unhealthy',
      latencyMs: 0,
      message: `No connectivity probe is registered for connector type ${connectorType}.`,
    };
  }
}
