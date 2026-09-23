import { ConnectorContext } from '@app/credential-ports';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { assertSafeConnectorUrl } from '../common/assert-safe-connector-url';
import { buildTractionWalletUrl } from '../common/traction-request';

import { TractionHttpClient } from './traction-http-client.service';
import { TractionTokenManager } from './traction-token-manager.service';

interface TractionWalletSettings {
  readonly wallet_webhook_urls?: string[];
}

/** Fixed advisory-lock class id for Traction webhook registration writes. */
export const TRACTION_WEBHOOK_LOCK_CLASS = 4209;

/**
 * Registers this connector's inbound webhook URL and secret with Traction,
 * so Traction calls back to us on protocol state changes.
 *
 * Traction's tenant wallet self-service endpoint (`PUT /tenant/wallet`)
 * replaces the whole `wallet_webhook_urls` list rather than accepting a
 * single add/remove, so a naive PUT would silently drop any other webhook
 * URL already registered on this wallet. This reads the current list first,
 * replaces only the entry for our own webhook URL (matched by the URL
 * portion before its `#secret` fragment), and leaves every other entry
 * untouched.
 */
@Injectable()
export class TractionWebhookRegistrar {
  public constructor(
    private readonly httpClient: TractionHttpClient,
    private readonly tokenManager: TractionTokenManager,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * Connector credentials don't enforce one connector per Traction wallet,
   * so two registrations against the same `endpointUrl` can race: both read
   * the same `wallet_webhook_urls`, and the later PUT silently drops the
   * other's newly added entry. `pg_advisory_xact_lock`, keyed on the wallet's
   * endpoint URL, serializes the read-modify-write across replicas (same
   * pattern as role-scope.repository.ts); the lock releases on commit or
   * rollback.
   */
  public async ensureWebhookRegistered(
    context: ConnectorContext,
    webhookUrl: string,
    webhookSecret: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
        TRACTION_WEBHOOK_LOCK_CLASS,
        context.endpointUrl,
      ]);

      const { url, headers, entries } = await this.fetchCurrentEntries(context);

      const otherEntries = entries.filter(
        (entry) => !this.isOurEntry(entry, webhookUrl),
      );

      await this.httpClient.request({
        method: 'PUT',
        url,
        headers,
        data: {
          wallet_webhook_urls: [
            ...otherEntries,
            `${webhookUrl}#${webhookSecret}`,
          ],
        },
      });
    });
  }

  /**
   * Whether Traction's wallet currently has exactly this webhook url/secret
   * registered. Used to distinguish an `ensureWebhookRegistered` failure that
   * never reached Traction from one where the PUT was applied remotely but
   * the response was lost (e.g. a timeout) — callers must not assume the
   * latter is safely reversible.
   */
  public async isWebhookRegistered(
    context: ConnectorContext,
    webhookUrl: string,
    webhookSecret: string,
  ): Promise<boolean> {
    const { entries } = await this.fetchCurrentEntries(context);

    return entries.includes(`${webhookUrl}#${webhookSecret}`);
  }

  private async fetchCurrentEntries(context: ConnectorContext): Promise<{
    url: string;
    headers: Record<string, string>;
    entries: string[];
  }> {
    await assertSafeConnectorUrl(context.endpointUrl);

    const token = await this.tokenManager.getToken(context);
    const url = buildTractionWalletUrl(context.endpointUrl);
    const headers = { Authorization: `Bearer ${token}` };

    // codeql[js/request-forgery]: context.endpointUrl is validated
    // immediately above by assertSafeConnectorUrl (https-only, DNS-checked
    // against private/loopback/reserved ranges); the request path has no
    // other tenant-controlled segment.
    const current = await this.httpClient.request<TractionWalletSettings>({
      method: 'GET',
      url,
      headers,
    });

    return { url, headers, entries: current.data.wallet_webhook_urls ?? [] };
  }

  private isOurEntry(entry: string, webhookUrl: string): boolean {
    return entry === webhookUrl || entry.startsWith(`${webhookUrl}#`);
  }
}
