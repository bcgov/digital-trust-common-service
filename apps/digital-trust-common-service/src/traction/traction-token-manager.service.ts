import {
  ConnectorContext,
  ConnectorUnavailableError,
} from '@app/credential-ports';
import { Injectable, Logger } from '@nestjs/common';
import { decodeJwt } from 'jose';

import { assertSafeConnectorUrl } from '../common/assert-safe-connector-url';
import {
  buildTractionTokenRequestBody,
  buildTractionTokenUrl,
} from '../common/traction-token-request';

import { TractionHttpClient } from './traction-http-client.service';

interface CachedToken {
  readonly token: string;
  readonly expiresAtMs: number;
}

interface TractionTokenResponse {
  readonly token: string;
}

// Fetch a fresh token this long before the cached one actually expires, so a
// call starting just before expiry doesn't race the token dying mid-flight.
const EXPIRY_SAFETY_MARGIN_MS = 30_000;

/**
 * Manages Traction multitenancy bearer tokens: fetches, caches in-memory per
 * pod, and refreshes them once their JWT `exp` claim is close to expiring.
 *
 * Cached by ConnectorCredential.id rather than tractionTenantId alone — a
 * tenant could reconfigure the same Traction sub-tenant under a new
 * ConnectorCredential row (e.g. after rotating its api_key), and that should
 * start with a fresh token rather than reusing one cached under the old row.
 *
 * The cache is a plain per-pod in-memory Map (see docs/ARCHITECTURE.md,
 * "Why No Redis"): not shared across pods and does not survive a restart —
 * a cold pod just pays for one extra token fetch per connector.
 */
@Injectable()
export class TractionTokenManager {
  private readonly logger = new Logger(TractionTokenManager.name);

  private readonly cache = new Map<string, CachedToken>();

  public constructor(private readonly httpClient: TractionHttpClient) {}

  public async getToken(context: ConnectorContext): Promise<string> {
    const cached = this.cache.get(context.connectorId);

    if (cached && cached.expiresAtMs > Date.now() + EXPIRY_SAFETY_MARGIN_MS) {
      return cached.token;
    }

    // Re-validate SSRF only on a cache miss rather than on every call: the
    // endpoint URL only matters at the point we're about to make a fresh
    // outbound request to it.
    const { apiKey, tractionTenantId } = this.readCredentials(context);

    await assertSafeConnectorUrl(context.endpointUrl);

    const response = await this.httpClient.request<TractionTokenResponse>({
      method: 'POST',
      url: buildTractionTokenUrl(context.endpointUrl, tractionTenantId),
      data: buildTractionTokenRequestBody(apiKey),
    });

    const token = response.data.token;

    this.cache.set(context.connectorId, {
      token,
      expiresAtMs: this.readExpiry(token, context),
    });

    return token;
  }

  public reset(): void {
    this.cache.clear();
  }

  private readCredentials(context: ConnectorContext): {
    apiKey: string;
    tractionTenantId: string;
  } {
    const { apiKey, tractionTenantId } = context.credentials;

    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw new ConnectorUnavailableError(
        `Connector '${context.connectorId}' is missing its apiKey credential`,
        { connectorId: context.connectorId, tenantId: context.tenantId },
      );
    }

    if (typeof tractionTenantId !== 'string' || tractionTenantId.length === 0) {
      throw new ConnectorUnavailableError(
        `Connector '${context.connectorId}' is missing its tractionTenantId credential`,
        { connectorId: context.connectorId, tenantId: context.tenantId },
      );
    }

    return { apiKey, tractionTenantId };
  }

  /**
   * Reads the token's `exp` claim (seconds since epoch) and converts it to a
   * millisecond timestamp. Traction issues these tokens, so it does not have
   * a signing key of ours to verify against here — the token is opaque to
   * us beyond its expiry, and is verified by Traction itself on each call.
   */
  private readExpiry(token: string, context: ConnectorContext): number {
    try {
      const { exp } = decodeJwt(token);

      if (typeof exp !== 'number') {
        throw new Error('token has no exp claim');
      }

      return exp * 1000;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(
        `Connector '${context.connectorId}' returned a token without a usable exp claim: ${message}`,
      );

      // Fail closed to "already expired" instead of caching a token forever
      // under a guessed TTL: the next call just re-fetches.
      return Date.now();
    }
  }
}
