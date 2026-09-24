import {
  ConnectorContext,
  ConnectorUnavailableError,
} from '@app/credential-ports';
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
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

// The cache state each lifecycle event was reached from: `hit` served a live
// cached token, `miss` had nothing cached, `expiring` had a token inside the
// safety margin above. `miss` and `expiring` both mean an outbound fetch, and
// separating them is what tells a cold pod apart from a short token TTL.
const CACHE_STATE_EXPIRING = 'expiring';
const CACHE_STATE_HIT = 'hit';
const CACHE_STATE_MISS = 'miss';

const OUTCOME_FAILURE = 'failure';
const OUTCOME_SUCCESS = 'success';

/** The fields of a failed acquisition this service is willing to log. */
interface DescribedFailure {
  error_message: string;
  error_stack?: string;
  error_type: string;
  status_code?: number;
}

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
 *
 * Each call emits one token lifecycle event carrying the outcome and the cache
 * state it was reached from, never the token or the api_key exchanged for it.
 * See docs/ARCHITECTURE.md, "Token lifecycle events".
 */
@Injectable()
export class TractionTokenManager {
  private readonly logger = new Logger(TractionTokenManager.name);

  private readonly cache = new Map<string, CachedToken>();

  public constructor(private readonly httpClient: TractionHttpClient) {}

  public async getToken(context: ConnectorContext): Promise<string> {
    const cached = this.cache.get(context.connectorId);

    if (cached && cached.expiresAtMs > Date.now() + EXPIRY_SAFETY_MARGIN_MS) {
      // Debug rather than info: a hit happens on every outbound Traction call,
      // so emitting it at info would roughly double the access log for no new
      // signal — the hit count is the call count minus the acquisitions below.
      // A hit is what normal looks like; the fetches are what's worth seeing.
      this.logger.debug(
        {
          cache_state: CACHE_STATE_HIT,
          connector_id: context.connectorId,
          outcome: OUTCOME_SUCCESS,
        },
        'token served from cache',
      );

      return cached.token;
    }

    const cacheState =
      cached === undefined ? CACHE_STATE_MISS : CACHE_STATE_EXPIRING;
    const startedAt = Date.now();

    // Every field is named explicitly and the token is never among them:
    // `tenant_id`, `request_id`, and `operation_id` are attached by the pino
    // mixin from the request context, so nothing is threaded through for them.
    try {
      const token = await this.acquireToken(context);

      this.logger.log(
        {
          cache_state: cacheState,
          connector_id: context.connectorId,
          duration_ms: Date.now() - startedAt,
          outcome: OUTCOME_SUCCESS,
        },
        'token acquired',
      );

      return token;
    } catch (error) {
      this.logger.error(
        {
          cache_state: cacheState,
          connector_id: context.connectorId,
          duration_ms: Date.now() - startedAt,
          ...describeFailure(error),
          outcome: OUTCOME_FAILURE,
        },
        'token acquisition failed',
      );

      throw error;
    }
  }

  public reset(): void {
    this.cache.clear();
  }

  private async acquireToken(context: ConnectorContext): Promise<string> {
    // Re-validate SSRF only on a cache miss rather than on every call: the
    // endpoint URL only matters at the point we're about to make a fresh
    // outbound request to it.
    const { apiKey, tractionTenantId } = this.readCredentials(context);

    await assertSafeConnectorUrl(context.endpointUrl);

    // codeql[js/request-forgery]: context.endpointUrl is validated
    // immediately above by assertSafeConnectorUrl (https-only, DNS-checked
    // against private/loopback/reserved ranges); tractionTenantId is
    // percent-encoded by buildTractionTokenUrl so it can only affect the
    // path on that already-validated host.
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
        {
          connector_id: context.connectorId,
          error_message: message,
        },
        'token expiry claim unusable',
      );

      // Fail closed to "already expired" instead of caching a token forever
      // under a guessed TTL: the next call just re-fetches.
      return Date.now();
    }
  }
}

/**
 * Describes a failed acquisition without reaching into the thrown value.
 *
 * An axios error carries the request it was made from, and that request body
 * is `{ api_key }` — the connector's Traction API key. pino treats any value
 * with a string `message` as an error and copies every own enumerable property
 * off it, so logging the error itself would put `config.data.api_key` in the
 * log line. An allowlist makes that exclusion structural rather than leaving
 * it to redaction, which only matches key names it was told about in advance
 * and only to a fixed depth.
 *
 * `status_code` is taken from the response rather than parsed out of the
 * message: a 401 (rotated api_key) and a 503 (Traction down) are the two
 * failures an operator has to tell apart, and both arrive here as the same
 * error type.
 */
function describeFailure(error: unknown): DescribedFailure {
  if (axios.isAxiosError(error)) {
    return {
      error_message: error.message,
      error_stack: error.stack,
      error_type: error.name,
      ...(error.response === undefined
        ? {}
        : { status_code: error.response.status }),
    };
  }

  if (error instanceof Error) {
    return {
      error_message: error.message,
      error_stack: error.stack,
      error_type: error.name,
    };
  }

  // A thrown non-Error is stringified rather than inspected, so an object
  // carrying arbitrary fields cannot smuggle them into the log either.
  return { error_message: String(error), error_type: typeof error };
}
