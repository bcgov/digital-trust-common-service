import { ConnectorContext } from '@app/credential-ports';
import { DataSource } from 'typeorm';

import { assertSafeConnectorUrl } from '../common/assert-safe-connector-url';

import { TractionHttpClient } from './traction-http-client.service';
import { TractionTokenManager } from './traction-token-manager.service';
import {
  TRACTION_WEBHOOK_LOCK_CLASS,
  TractionWebhookRegistrar,
} from './traction-webhook-registrar.service';

jest.mock('../common/assert-safe-connector-url');

const mockedAssertSafeConnectorUrl = assertSafeConnectorUrl as jest.Mock;

function makeContext(
  overrides: Partial<ConnectorContext> = {},
): ConnectorContext {
  return {
    connectorId: 'connector-1',
    tenantId: 'tenant-1',
    endpointUrl: 'https://traction.example.com',
    credentials: { apiKey: 'key-1', tractionTenantId: 'traction-tenant-1' },
    ...overrides,
  };
}

describe('TractionWebhookRegistrar', () => {
  let registrar: TractionWebhookRegistrar;
  let mockRequest: jest.Mock;
  let mockGetToken: jest.Mock;
  let mockLockQuery: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAssertSafeConnectorUrl.mockResolvedValue(undefined);
    mockRequest = jest.fn();
    mockGetToken = jest.fn().mockResolvedValue('bearer-token');
    mockLockQuery = jest.fn();

    // The advisory lock is taken on the transaction's manager, same pattern
    // as role-scope.repository.ts / dev-seed.service.ts.
    const lockManager = { query: mockLockQuery };
    const dataSource = {
      transaction: jest.fn(
        (work: (manager: typeof lockManager) => Promise<unknown>) =>
          work(lockManager),
      ),
    };

    registrar = new TractionWebhookRegistrar(
      { request: mockRequest } as unknown as TractionHttpClient,
      { getToken: mockGetToken } as unknown as TractionTokenManager,
      dataSource as unknown as DataSource,
    );
  });

  it('adds the webhook entry when the wallet has none configured', async () => {
    mockRequest.mockResolvedValueOnce({ data: {} });
    mockRequest.mockResolvedValueOnce({ data: {} });

    const context = makeContext();
    await registrar.ensureWebhookRegistered(
      context,
      'https://app.localhost/api/v1/connectors/connector-1/webhooks',
      'shh-secret',
    );

    expect(mockLockQuery).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock($1, hashtext($2))',
      [TRACTION_WEBHOOK_LOCK_CLASS, context.endpointUrl],
    );
    expect(mockedAssertSafeConnectorUrl).toHaveBeenCalledWith(
      context.endpointUrl,
    );
    expect(mockGetToken).toHaveBeenCalledWith(context);
    expect(mockRequest).toHaveBeenNthCalledWith(1, {
      method: 'GET',
      url: 'https://traction.example.com/tenant/wallet',
      headers: { Authorization: 'Bearer bearer-token' },
    });
    expect(mockRequest).toHaveBeenNthCalledWith(2, {
      method: 'PUT',
      url: 'https://traction.example.com/tenant/wallet',
      headers: { Authorization: 'Bearer bearer-token' },
      data: {
        wallet_webhook_urls: [
          'https://app.localhost/api/v1/connectors/connector-1/webhooks#shh-secret',
        ],
      },
    });
  });

  it('preserves unrelated existing webhook urls', async () => {
    mockRequest.mockResolvedValueOnce({
      data: {
        wallet_webhook_urls: ['https://someone-else.example/hook#other'],
      },
    });
    mockRequest.mockResolvedValueOnce({ data: {} });

    await registrar.ensureWebhookRegistered(
      makeContext(),
      'https://app.localhost/api/v1/connectors/connector-1/webhooks',
      'shh-secret',
    );

    expect(mockRequest).toHaveBeenNthCalledWith(2, {
      method: 'PUT',
      url: 'https://traction.example.com/tenant/wallet',
      headers: { Authorization: 'Bearer bearer-token' },
      data: {
        wallet_webhook_urls: [
          'https://someone-else.example/hook#other',
          'https://app.localhost/api/v1/connectors/connector-1/webhooks#shh-secret',
        ],
      },
    });
  });

  it('replaces a stale entry for this same webhook url instead of duplicating it', async () => {
    mockRequest.mockResolvedValueOnce({
      data: {
        wallet_webhook_urls: [
          'https://app.localhost/api/v1/connectors/connector-1/webhooks#old-secret',
        ],
      },
    });
    mockRequest.mockResolvedValueOnce({ data: {} });

    await registrar.ensureWebhookRegistered(
      makeContext(),
      'https://app.localhost/api/v1/connectors/connector-1/webhooks',
      'new-secret',
    );

    expect(mockRequest).toHaveBeenNthCalledWith(2, {
      method: 'PUT',
      url: 'https://traction.example.com/tenant/wallet',
      headers: { Authorization: 'Bearer bearer-token' },
      data: {
        wallet_webhook_urls: [
          'https://app.localhost/api/v1/connectors/connector-1/webhooks#new-secret',
        ],
      },
    });
  });

  describe('isWebhookRegistered', () => {
    it('returns true when the exact webhook url and secret are present', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          wallet_webhook_urls: [
            'https://app.localhost/api/v1/connectors/connector-1/webhooks#shh-secret',
          ],
        },
      });

      const result = await registrar.isWebhookRegistered(
        makeContext(),
        'https://app.localhost/api/v1/connectors/connector-1/webhooks',
        'shh-secret',
      );

      expect(result).toBe(true);
      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith({
        method: 'GET',
        url: 'https://traction.example.com/tenant/wallet',
        headers: { Authorization: 'Bearer bearer-token' },
      });
    });

    it('returns false when the entry is missing or has a different secret', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          wallet_webhook_urls: [
            'https://app.localhost/api/v1/connectors/connector-1/webhooks#old-secret',
          ],
        },
      });

      const result = await registrar.isWebhookRegistered(
        makeContext(),
        'https://app.localhost/api/v1/connectors/connector-1/webhooks',
        'shh-secret',
      );

      expect(result).toBe(false);
    });

    it("propagates a failure to check Traction's current state", async () => {
      mockRequest.mockRejectedValueOnce(new Error('Traction unreachable'));

      await expect(
        registrar.isWebhookRegistered(
          makeContext(),
          'https://app.localhost/api/v1/connectors/connector-1/webhooks',
          'shh-secret',
        ),
      ).rejects.toThrow('Traction unreachable');
    });
  });
});
