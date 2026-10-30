import {
  ConnectorType,
  type ConnectorHealthCheckResult,
  type ConnectorProbe,
} from '@app/credential-ports';
import { Injectable, Logger } from '@nestjs/common';
import { decodeJwt } from 'jose';

import { assertSafeConnectorUrl } from '../common/assert-safe-connector-url';
import {
  buildTractionTokenRequestBody,
  buildTractionTokenUrl,
} from '../common/traction-request';

const HEALTH_CHECK_TIMEOUT_MS = 5000;
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Authenticates against Traction's tenant token endpoint and reads the
 * sub-wallet id from the issued token as the agent log identifier.
 */
@Injectable()
export class TractionConnectorProbe implements ConnectorProbe {
  public readonly connectorType = ConnectorType.Traction;

  private readonly logger = new Logger(TractionConnectorProbe.name);

  public async check(
    endpointUrl: string,
    credentials: Readonly<Record<string, unknown>>,
  ): Promise<ConnectorHealthCheckResult> {
    await assertSafeConnectorUrl(endpointUrl);

    const start = Date.now();
    const { apiKey, tractionTenantId } = credentials;

    if (
      typeof tractionTenantId !== 'string' ||
      tractionTenantId === '' ||
      typeof apiKey !== 'string'
    ) {
      return {
        status: 'unhealthy',
        latencyMs: Date.now() - start,
        message: 'Traction connectors require traction_tenant_id.',
      };
    }

    try {
      // codeql[js/request-forgery]: endpointUrl is validated immediately
      // above by assertSafeConnectorUrl (https-only, DNS-checked against
      // private/loopback/reserved ranges); tractionTenantId is
      // percent-encoded by buildTractionTokenUrl so it can only affect the
      // path on that already-validated host.
      const response = await fetch(
        buildTractionTokenUrl(endpointUrl, tractionTenantId),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildTractionTokenRequestBody(apiKey)),
          signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
          redirect: 'manual',
        },
      );
      const latencyMs = Date.now() - start;

      if (!response.ok) {
        return {
          status: 'unhealthy',
          latencyMs,
          message: `Unexpected response status ${response.status}`,
        };
      }

      const result: ConnectorHealthCheckResult = {
        status: 'healthy',
        latencyMs,
      };
      const walletId = await this.readWalletId(response);

      if (walletId !== undefined) {
        result.agentLogId = walletId;
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(
        `Connectivity check failed for endpoint ${endpointUrl}: ${message}`,
      );

      return { status: 'unhealthy', latencyMs: Date.now() - start, message };
    }
  }

  /**
   * Reads the sub-wallet id from the token Traction just issued. The token is
   * decoded without signature verification (we hold no key for the agent), so
   * the value is only as trustworthy as the endpoint that returned it.
   * Nothing here proves the endpoint is a trusted agent (see
   * docs/tenant-log-access-contract.md §4.1 M1); that provenance is not
   * established by this check.
   */
  private async readWalletId(response: Response): Promise<string | undefined> {
    try {
      const body = (await response.json()) as { token?: unknown };

      if (typeof body.token !== 'string') {
        return undefined;
      }

      const { wallet_id: walletId } = decodeJwt(body.token);

      if (
        typeof walletId === 'string' &&
        CANONICAL_UUID_PATTERN.test(walletId)
      ) {
        return walletId;
      }

      this.logger.warn(
        'Traction token carried no usable wallet_id claim; agent logs will not be attributable to this connector.',
      );
    } catch {
      this.logger.warn(
        'Traction token response could not be read for a wallet_id claim.',
      );
    }

    return undefined;
  }
}
