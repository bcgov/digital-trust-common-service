import { ConnectorContext } from '@app/credential-ports';
import { Injectable } from '@nestjs/common';

import { assertSafeConnectorUrl } from '../common/assert-safe-connector-url';
import { buildTractionWalletUrl } from '../common/traction-request';

import { TractionHttpClient } from './traction-http-client.service';
import { TractionTokenManager } from './traction-token-manager.service';

interface TractionWalletSettings {
  readonly wallet_webhook_urls?: string[];
}

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
  ) {}

  public async ensureWebhookRegistered(
    context: ConnectorContext,
    webhookUrl: string,
    webhookSecret: string,
  ): Promise<void> {
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

    const otherEntries = (current.data.wallet_webhook_urls ?? []).filter(
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
  }

  private isOurEntry(entry: string, webhookUrl: string): boolean {
    return entry === webhookUrl || entry.startsWith(`${webhookUrl}#`);
  }
}
