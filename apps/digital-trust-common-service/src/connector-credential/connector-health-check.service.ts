import { Injectable, Logger } from '@nestjs/common';

import { assertSafeConnectorUrl } from '../common/assert-safe-connector-url';
import { ConnectorType } from '../connection/connection.entity';

import { ConnectorCredentialsDto } from './dto/create-connector-credential.dto';

const HEALTH_CHECK_TIMEOUT_MS = 5000;

export type ConnectorHealthStatus = 'healthy' | 'unhealthy';

export interface ConnectorHealthCheckResult {
  status: ConnectorHealthStatus;
  latencyMs: number;
  message?: string;
}

/**
 * Attempts to authenticate against, and health-check, a tenant's backend
 * agent endpoint (Traction or Credo Agent Service).
 *
 * PROVISIONAL: neither agent's exact API contract has been verified against
 * a real deployment or vendor documentation checked into this repo. The
 * request shapes below are best-effort placeholders — revisit once the real
 * Traction/Credo Agent Service contracts are confirmed.
 */
@Injectable()
export class ConnectorHealthCheckService {
  private readonly logger = new Logger(ConnectorHealthCheckService.name);

  public async check(
    connectorType: ConnectorType,
    endpointUrl: string,
    credentials: ConnectorCredentialsDto,
  ): Promise<ConnectorHealthCheckResult> {
    await assertSafeConnectorUrl(endpointUrl);

    switch (connectorType) {
      case ConnectorType.TRACTION:
        return await this.checkTraction(endpointUrl, credentials);
      case ConnectorType.CREDO:
        return await this.checkCredo(endpointUrl, credentials);
    }
  }

  private async checkTraction(
    endpointUrl: string,
    credentials: ConnectorCredentialsDto,
  ): Promise<ConnectorHealthCheckResult> {
    const start = Date.now();

    try {
      const response = credentials.tractionTenantId
        ? await fetch(
            `${endpointUrl}/multitenancy/tenant/${credentials.tractionTenantId}/token`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ api_key: credentials.apiKey }),
              signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
            },
          )
        : await fetch(`${endpointUrl}/status/ready`, {
            headers: { Authorization: `Bearer ${credentials.apiKey}` },
            signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
          });

      return this.toResult(response, start);
    } catch (error) {
      return this.toErrorResult(error, start, endpointUrl);
    }
  }

  // TODO: provisional — confirm the real Credo Agent Service health/auth
  // contract (endpoint path + auth scheme) and adjust accordingly.
  private async checkCredo(
    endpointUrl: string,
    credentials: ConnectorCredentialsDto,
  ): Promise<ConnectorHealthCheckResult> {
    const start = Date.now();

    try {
      const response = await fetch(`${endpointUrl}/health`, {
        headers: { Authorization: `Bearer ${credentials.apiKey}` },
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
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
