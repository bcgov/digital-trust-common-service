import {
  ConnectorContext,
  ConnectorUnavailableError,
} from '@app/credential-ports';

import { assertSafeConnectorUrl } from '../common/assert-safe-connector-url';

import { TractionHttpClient } from './traction-http-client.service';
import { TractionTokenManager } from './traction-token-manager.service';

jest.mock('../common/assert-safe-connector-url');

const mockedAssertSafeConnectorUrl = assertSafeConnectorUrl as jest.Mock;

function makeJwt(payload: Record<string, unknown>): string {
  const base64url = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');

  return `${base64url({ alg: 'none' })}.${base64url(payload)}.signature`;
}

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

describe('TractionTokenManager', () => {
  let manager: TractionTokenManager;
  let mockRequest: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(0);
    jest.clearAllMocks();
    mockRequest = jest.fn();
    mockedAssertSafeConnectorUrl.mockResolvedValue(undefined);

    manager = new TractionTokenManager({
      request: mockRequest,
    } as unknown as TractionHttpClient);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fetches a token from the tenant token endpoint on a cache miss', async () => {
    const token = makeJwt({ exp: 3600 });
    mockRequest.mockResolvedValue({ data: { token } });

    const context = makeContext();
    const result = await manager.getToken(context);

    expect(result).toBe(token);
    expect(mockedAssertSafeConnectorUrl).toHaveBeenCalledWith(
      context.endpointUrl,
    );
    expect(mockRequest).toHaveBeenCalledWith({
      method: 'POST',
      url: 'https://traction.example.com/multitenancy/wallet/traction-tenant-1/token',
      data: { api_key: 'key-1' },
    });
  });

  it('returns the cached token without re-fetching while it is still valid', async () => {
    const token = makeJwt({ exp: 3600 });
    mockRequest.mockResolvedValue({ data: { token } });

    const context = makeContext();
    await manager.getToken(context);
    const result = await manager.getToken(context);

    expect(result).toBe(token);
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockedAssertSafeConnectorUrl).toHaveBeenCalledTimes(1);
  });

  it('re-fetches once the cached token is within the expiry safety margin', async () => {
    const firstToken = makeJwt({ exp: 40 });
    const secondToken = makeJwt({ exp: 3600 });
    mockRequest
      .mockResolvedValueOnce({ data: { token: firstToken } })
      .mockResolvedValueOnce({ data: { token: secondToken } });

    const context = makeContext();
    await manager.getToken(context);

    // 40s exp, 30s safety margin — only 25s remain at 15s in, under margin.
    jest.setSystemTime(15_000);

    const result = await manager.getToken(context);

    expect(result).toBe(secondToken);
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('caches per connectorId even when tractionTenantId is shared', async () => {
    const token = makeJwt({ exp: 3600 });
    mockRequest.mockResolvedValue({ data: { token } });

    await manager.getToken(makeContext({ connectorId: 'connector-1' }));
    await manager.getToken(makeContext({ connectorId: 'connector-2' }));

    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('treats a token with no usable exp claim as already expired', async () => {
    const token = makeJwt({});
    mockRequest.mockResolvedValue({ data: { token } });

    const context = makeContext();
    await manager.getToken(context);
    await manager.getToken(context);

    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('rejects with ConnectorUnavailableError when apiKey is missing', async () => {
    const context = makeContext({
      credentials: { tractionTenantId: 'traction-tenant-1' },
    });

    await expect(manager.getToken(context)).rejects.toBeInstanceOf(
      ConnectorUnavailableError,
    );
    expect(mockedAssertSafeConnectorUrl).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects with ConnectorUnavailableError when tractionTenantId is missing', async () => {
    const context = makeContext({ credentials: { apiKey: 'key-1' } });

    await expect(manager.getToken(context)).rejects.toBeInstanceOf(
      ConnectorUnavailableError,
    );
    expect(mockedAssertSafeConnectorUrl).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('forgets cached tokens on reset', async () => {
    const token = makeJwt({ exp: 3600 });
    mockRequest.mockResolvedValue({ data: { token } });

    const context = makeContext();
    await manager.getToken(context);
    manager.reset();
    await manager.getToken(context);

    expect(mockRequest).toHaveBeenCalledTimes(2);
  });
});
