import {
  CONNECTOR_PROBES,
  type ConnectorHealthCheckResult,
  type ConnectorProbe,
} from '@app/credential-ports';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { isValidAgentLogId } from '../common/agent-log-partition-key';
import { assertSafeConnectorUrl } from '../common/assert-safe-connector-url';
import { ConnectorType } from '../connection/connection.entity';

import { ConnectorCredentialsDto } from './dto/create-connector-credential.dto';

const HEALTH_CHECK_TIMEOUT_MS = 5000;

/**
 * Health-checks a tenant's backend agent endpoint. Connector types with a
 * registered ConnectorProbe are dispatched to it; Credo still uses the
 * provisional check below.
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

    if (connectorType === ConnectorType.CREDO) {
      return await this.checkCredo(endpointUrl, credentials);
    }

    return {
      status: 'unhealthy',
      latencyMs: 0,
      message: `No connectivity probe is registered for connector type ${connectorType}.`,
    };
  }

  // TODO: provisional — confirm the real Credo Agent Service health/auth
  // contract (endpoint path + auth scheme) and adjust accordingly.
  private async checkCredo(
    endpointUrl: string,
    credentials: ConnectorCredentialsDto,
  ): Promise<ConnectorHealthCheckResult> {
    await assertSafeConnectorUrl(endpointUrl);

    const start = Date.now();

    try {
      // codeql[js/request-forgery]: endpointUrl is validated immediately
      // above by assertSafeConnectorUrl (https-only, DNS-checked against
      // private/loopback/reserved ranges).
      const response = await fetch(`${endpointUrl}/health`, {
        headers: { Authorization: `Bearer ${credentials.apiKey}` },
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
        redirect: 'manual',
      });

      return this.toResult(response, start);
    } catch (error) {
      return this.toErrorResult(error, start, endpointUrl);
    }
  }

  private toResult(
    response: Response,
    start: number,
  ): ConnectorHealthCheckResult {
    const latencyMs = Date.now() - start;

    if (!response.ok) {
      return {
        status: 'unhealthy',
        latencyMs,
        message: `Unexpected response status ${response.status}`,
      };
    }

    return { status: 'healthy', latencyMs };
  }

  private toErrorResult(
    error: unknown,
    start: number,
    endpointUrl: string,
  ): ConnectorHealthCheckResult {
    const latencyMs = Date.now() - start;
    const message = error instanceof Error ? error.message : String(error);

    this.logger.warn(
      `Connectivity check failed for endpoint ${endpointUrl}: ${message}`,
    );

    return { status: 'unhealthy', latencyMs, message };
  }
}
