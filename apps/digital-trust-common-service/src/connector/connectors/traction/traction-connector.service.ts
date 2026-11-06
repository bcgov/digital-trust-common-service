import { randomBytes } from 'crypto';

import type { ConnectorContext } from '@app/credential-ports';
import { OidcConfigService } from '@app/oidc/config';
import { Injectable, Logger } from '@nestjs/common';
import { decodeJwt } from 'jose';

import { assertSafeConnectorUrl } from '../../../common/assert-safe-connector-url';
import { API_BASE_PATH } from '../../../common/constants/api-version.constants';
import {
  buildTractionTokenRequestBody,
  buildTractionTokenUrl,
} from '../../../common/traction-request';
import { ConnectorType } from '../../../connection/connection.entity';
import { ConnectorDto } from '../../dto/create-connector.dto';
import {
  type ConnectorHealthCheckResult,
  AbstractConnector,
} from '../abstract-connector.service';

import { TractionTokenManager } from './traction-token-manager.service';
import { TractionWebhookRegistrar } from './traction-webhook-registrar.service';

const HEALTH_CHECK_TIMEOUT_MS = 5000;
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

@Injectable()
export class TractionConnector extends AbstractConnector {
  public readonly connectorType = ConnectorType.TRACTION;

  private readonly logger = new Logger(TractionConnector.name);

  public constructor(
    private readonly webhookRegistrar: TractionWebhookRegistrar,
    private readonly tokenManager: TractionTokenManager,
    private readonly oidcConfigService: OidcConfigService,
  ) {
    super();
  }

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

  public prepareCredentials(credentials: ConnectorDto): void {
    if (!credentials.webhookSecret) {
      credentials.webhookSecret = randomBytes(32).toString('hex');
    }
  }

  public mergeCredentials(
    existing: ConnectorDto,
    updates: Partial<ConnectorDto>,
  ): ConnectorDto {
    return {
      ...existing,
      ...(updates.apiKey !== undefined ? { apiKey: updates.apiKey } : {}),
      ...(updates.tractionTenantId !== undefined
        ? { tractionTenantId: updates.tractionTenantId }
        : {}),
      ...(updates.webhookSecret !== undefined
        ? { webhookSecret: updates.webhookSecret }
        : {}),
    };
  }

  public async ensureWebhookRegistered(
    context: ConnectorContext,
  ): Promise<void> {
    await this.webhookRegistrar.ensureWebhookRegistered(
      context,
      this.buildWebhookUrl(context.connectorId),
      context.credentials.webhookSecret as string,
    );
  }

  public async isWebhookRegistered(
    context: ConnectorContext,
  ): Promise<boolean> {
    return this.webhookRegistrar.isWebhookRegistered(
      context,
      this.buildWebhookUrl(context.connectorId),
      context.credentials.webhookSecret as string,
    );
  }

  public evict(connectorId: string): void {
    this.tokenManager.evict(connectorId);
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

  private buildWebhookUrl(connectorId: string): string {
    const origin = this.oidcConfigService.getConfig().publicUrl;

    return `${origin}${API_BASE_PATH}/connectors/${connectorId}/webhooks/traction`;
  }
}
