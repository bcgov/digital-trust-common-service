import {
  ConnectorContext,
  ConnectorUnavailableError,
} from '@app/credential-ports';
import { Logger } from '@nestjs/common';
import {
  AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import pino from 'pino';

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

/**
 * An axios error shaped the way one from the token endpoint really is: it
 * carries the request that produced it, and that request body is the
 * connector's `api_key`. The leak tests below depend on that being present.
 *
 * Omitting `status` gives the transport-failure shape — a refused connection
 * or a timeout, where nothing ever answered and there is no response to read.
 */
function makeAxiosError(status?: number): AxiosError {
  const config = {
    method: 'POST',
    url: 'https://traction.example.com/multitenancy/tenant/traction-tenant-1/token',
    data: { api_key: 'key-1' },
    headers: {},
  } as unknown as InternalAxiosRequestConfig;

  if (status === undefined) {
    return new AxiosError(
      'connect ECONNREFUSED 10.0.0.1:443',
      AxiosError.ERR_NETWORK,
      config,
      {},
    );
  }

  return new AxiosError(
    `Request failed with status code ${status}`,
    AxiosError.ERR_BAD_REQUEST,
    config,
    {},
    {
      config,
      data: { detail: 'Invalid api_key' },
      headers: {},
      status,
      statusText: 'Unauthorized',
    } as AxiosResponse,
  );
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
  let logDebug: jest.SpiedFunction<typeof Logger.prototype.debug>;
  let logError: jest.SpiedFunction<typeof Logger.prototype.error>;
  let logLine: jest.SpiedFunction<typeof Logger.prototype.log>;
  let logWarn: jest.SpiedFunction<typeof Logger.prototype.warn>;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(0);
    jest.clearAllMocks();
    mockRequest = jest.fn();
    mockedAssertSafeConnectorUrl.mockResolvedValue(undefined);

    // The manager's logger is an instance field, so the prototype is the seam.
    // Stubbed for every test rather than only the event ones: the lifecycle
    // events fire on each call, and letting them reach the console would bury
    // the run in output no assertion reads.
    logDebug = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    logLine = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    logWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    manager = new TractionTokenManager({
      request: mockRequest,
    } as unknown as TractionHttpClient);
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
      url: 'https://traction.example.com/multitenancy/tenant/traction-tenant-1/token',
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

  /**
   * The token lifecycle events: success or failure, and the cache state
   * each was reached from. The assertions name the whole payload rather than
   * the interesting key, so a field added later has to be added here
   * deliberately — that is the control that keeps the token and the connector's
   * `api_key` out, not the redaction backstop in the logger config.
   *
   * `tenant_id`, `request_id`, and `operation_id` are deliberately absent: the
   * pino mixin attaches them from the request context, so a call site adding
   * them would emit them twice and diverge whenever the context is richer.
   */
  describe('token lifecycle events', () => {
    it('logs an acquisition on a cache miss', async () => {
      mockRequest.mockResolvedValue({
        data: { token: makeJwt({ exp: 3600 }) },
      });

      await manager.getToken(makeContext());

      expect(logLine).toHaveBeenCalledWith(
        {
          cache_state: 'miss',
          connector_id: 'connector-1',
          duration_ms: expect.any(Number),
          outcome: 'success',
        },
        'token acquired',
      );
      expect(logError).not.toHaveBeenCalled();
    });

    it('logs a cache hit at debug rather than as an acquisition', async () => {
      mockRequest.mockResolvedValue({
        data: { token: makeJwt({ exp: 3600 }) },
      });

      const context = makeContext();
      await manager.getToken(context);
      logLine.mockClear();

      await manager.getToken(context);

      expect(logDebug).toHaveBeenCalledWith(
        {
          cache_state: 'hit',
          connector_id: 'connector-1',
          outcome: 'success',
        },
        'token served from cache',
      );
      expect(logLine).not.toHaveBeenCalled();
    });

    it('distinguishes a refresh inside the safety margin from a cold miss', async () => {
      mockRequest
        .mockResolvedValueOnce({ data: { token: makeJwt({ exp: 40 }) } })
        .mockResolvedValueOnce({ data: { token: makeJwt({ exp: 3600 }) } });

      const context = makeContext();
      await manager.getToken(context);

      jest.setSystemTime(15_000);
      await manager.getToken(context);

      expect(logLine).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ cache_state: 'miss' }),
        'token acquired',
      );
      expect(logLine).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ cache_state: 'expiring' }),
        'token acquired',
      );
    });

    it('logs a failed acquisition with the upstream status code', async () => {
      const error = makeAxiosError(401);
      mockRequest.mockRejectedValue(error);

      await expect(manager.getToken(makeContext())).rejects.toBe(error);

      expect(logLine).not.toHaveBeenCalled();
      expect(logError).toHaveBeenCalledWith(
        {
          cache_state: 'miss',
          connector_id: 'connector-1',
          duration_ms: expect.any(Number),
          error_message: 'Request failed with status code 401',
          error_stack: error.stack,
          error_type: 'AxiosError',
          outcome: 'failure',
          status_code: 401,
        },
        'token acquisition failed',
      );
    });

    it('reports a transport failure with no status code at all', async () => {
      const error = makeAxiosError();
      mockRequest.mockRejectedValue(error);

      await expect(manager.getToken(makeContext())).rejects.toBe(error);

      const [payload] = logError.mock.calls[0] as [Record<string, unknown>];

      // Nothing ever answered, so there is no status to report. The field is
      // absent rather than zero or null: "Traction is unreachable" and "the
      // api_key was rejected" are the two failures an operator has to tell
      // apart, and its presence is what separates them.
      expect(payload).not.toHaveProperty('status_code');
      expect(payload).toMatchObject({
        cache_state: 'miss',
        error_message: 'connect ECONNREFUSED 10.0.0.1:443',
        error_type: 'AxiosError',
        outcome: 'failure',
      });
      expect(JSON.stringify(payload)).not.toContain('key-1');
    });

    it('keeps the api_key the request carried out of the failure line', async () => {
      mockRequest.mockRejectedValue(makeAxiosError(401));

      await expect(manager.getToken(makeContext())).rejects.toBeInstanceOf(
        AxiosError,
      );

      const [payload] = logError.mock.calls[0] as [Record<string, unknown>];

      expect(Object.keys(payload).sort()).toEqual([
        'cache_state',
        'connector_id',
        'duration_ms',
        'error_message',
        'error_stack',
        'error_type',
        'outcome',
        'status_code',
      ]);
      expect(JSON.stringify(payload)).not.toContain('key-1');
    });

    it('survives serialization without pino reattaching the axios request', async () => {
      // A regression to logging the error itself would still pass the key
      // assertion above if pino were the thing expanding it, so drive the
      // payload through the same serializer the real logger uses.
      mockRequest.mockRejectedValue(makeAxiosError(401));

      await expect(manager.getToken(makeContext())).rejects.toBeInstanceOf(
        AxiosError,
      );

      const [payload] = logError.mock.calls[0] as [Record<string, unknown>];
      const serialized = JSON.stringify(
        Object.fromEntries(
          Object.entries(payload).map(([key, value]) => [
            key,
            pino.stdSerializers.err(value as Error),
          ]),
        ),
      );

      expect(serialized).not.toContain('key-1');
      expect(serialized).not.toContain('api_key');
    });

    it('logs a missing credential as a failure without reaching Traction', async () => {
      const context = makeContext({
        credentials: { tractionTenantId: 'traction-tenant-1' },
        tenantId: 'leaky-tenant',
      });

      await expect(manager.getToken(context)).rejects.toBeInstanceOf(
        ConnectorUnavailableError,
      );

      const [payload] = logError.mock.calls[0] as [Record<string, unknown>];

      expect(payload).toMatchObject({
        cache_state: 'miss',
        error_type: 'ConnectorUnavailableError',
        outcome: 'failure',
      });
      // ConnectorUnavailableError carries a context bag; only the allowlisted
      // fields are logged, so nothing from it reaches the line.
      expect(JSON.stringify(payload)).not.toContain('leaky-tenant');
    });

    it('never logs the token itself', async () => {
      const token = makeJwt({ exp: 3600 });
      mockRequest.mockResolvedValue({ data: { token } });

      const context = makeContext();
      await manager.getToken(context);
      await manager.getToken(context);

      const emitted = JSON.stringify([
        ...logDebug.mock.calls,
        ...logError.mock.calls,
        ...logLine.mock.calls,
        ...logWarn.mock.calls,
      ]);

      expect(emitted).not.toContain(token);
    });

    it('reports an unusable exp claim alongside the acquisition, not instead of it', async () => {
      mockRequest.mockResolvedValue({ data: { token: makeJwt({}) } });

      await manager.getToken(makeContext());

      expect(logWarn).toHaveBeenCalledWith(
        {
          connector_id: 'connector-1',
          error_message: 'token has no exp claim',
        },
        'token expiry claim unusable',
      );
      // The fetch itself worked, so the acquisition is still a success — it
      // just cannot be cached usefully. Two lines, not one, and the pair is
      // what says "we keep re-fetching and here is why".
      expect(logLine).toHaveBeenCalledWith(
        expect.objectContaining({ cache_state: 'miss', outcome: 'success' }),
        'token acquired',
      );
    });
  });
});
