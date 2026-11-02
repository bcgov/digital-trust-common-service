import {
  CONNECTOR_PROBES,
  type ConnectorHealthCheckResult,
  type ConnectorProbe,
} from '@app/credential-ports';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { isValidAgentLogId } from '../common/agent-log-partition-key';
import { ConnectorType } from '../connection/connection.entity';

import { ConnectorCredentialsDto } from './dto/create-connector-credential.dto';

/**
 * Health-checks a tenant's backend agent endpoint. Connector types with a
 * registered ConnectorProbe are dispatched to it; any other type is reported
 * unhealthy until a probe is registered.
 */
@Injectable()
export class ConnectorHealthCheckService {
  private readonly logger = new Logger(ConnectorHealthCheckService.name);

  public constructor(
    @Inject(CONNECTOR_PROBES)
    private readonly probes: readonly ConnectorProbe[],
  ) {}

  public async check(
    connectorType: ConnectorType,
    endpointUrl: string,
    credentials: ConnectorCredentialsDto,
  ): Promise<ConnectorHealthCheckResult> {
    const probe = this.probes.find(
      (candidate) =>
        (candidate.connectorType as string) === (connectorType as string),
    );

    if (probe) {
      const result = await probe.check(endpointUrl, { ...credentials });

      if (
        result.agentLogId !== undefined &&
        !isValidAgentLogId(result.agentLogId)
      ) {
        this.logger.warn(
          'Connector probe returned an unusable agent log identifier; discarding it.',
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
