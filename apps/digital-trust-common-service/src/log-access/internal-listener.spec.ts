import type { IncomingMessage } from 'http';

import { ExecutionContext, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import {
  createInternalListenerMiddleware,
  InternalListener,
  isInternalRequest,
} from './internal-listener';
import { InternalListenerGuard } from './internal-listener.guard';

const mockServer = {
  once: jest.fn(),
  listen: jest.fn((_port: number, cb: () => void) => cb()),
  close: jest.fn((cb: () => void) => cb()),
};
let capturedHandler: (req: IncomingMessage, res: unknown) => void;

jest.mock('https', () => ({
  createServer: jest.fn(
    (_opts: unknown, handler: typeof capturedHandler): typeof mockServer => {
      capturedHandler = handler;
      return mockServer;
    },
  ),
}));
jest.mock('fs', () => ({
  ...jest.requireActual<typeof import('fs')>('fs'),
  readFileSync: jest.fn(() => 'pem'),
}));

describe('internal listener', () => {
  const contextFor = (req: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => req }),
    }) as unknown as ExecutionContext;

  const startListener = async (
    values: Record<string, string>,
  ): Promise<{ handler: jest.Mock; listener: InternalListener }> => {
    const handler = jest.fn();
    const app = {
      init: jest.fn().mockResolvedValue(undefined),
      getHttpAdapter: () => ({ getInstance: () => handler }),
    };
    const config = {
      get: (key: string) => values[key],
      getOrThrow: (key: string) => values[key],
    } as unknown as ConfigService;
    const listener = new InternalListener(config);

    await listener.start(app as never);

    return { handler, listener };
  };

  beforeEach(() => jest.clearAllMocks());

  it('guard answers 404 for a request not on the internal listener', () => {
    expect(() =>
      new InternalListenerGuard().canActivate(contextFor({})),
    ).toThrow(NotFoundException);
  });

  it('middleware leaves public-port requests untouched', () => {
    const next = jest.fn();
    const res = { status: jest.fn() };

    createInternalListenerMiddleware()(
      { path: '/api/v1/tenants' } as never,
      res as never,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('does not listen when the port is unset', async () => {
    const { listener } = await startListener({});

    expect(mockServer.listen).not.toHaveBeenCalled();
    await expect(listener.onApplicationShutdown()).resolves.toBeUndefined();
    expect(mockServer.close).not.toHaveBeenCalled();
  });

  it('marks requests on the internal listener and confines them to the endpoint', async () => {
    const { handler, listener } = await startListener({
      LOG_ACCESS_INTERNAL_PORT: '8443',
      LOG_ACCESS_INTERNAL_TLS_CERT_PATH: '/tls/tls.crt',
      LOG_ACCESS_INTERNAL_TLS_KEY_PATH: '/tls/tls.key',
    });
    const req = { path: '/api/v1/tenants' } as unknown as IncomingMessage;

    capturedHandler(req, {});

    expect(mockServer.listen).toHaveBeenCalledWith(8443, expect.any(Function));
    expect(handler).toHaveBeenCalledWith(req, {});
    expect(isInternalRequest(req)).toBe(true);
    expect(new InternalListenerGuard().canActivate(contextFor(req))).toBe(true);

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();
    const middleware = createInternalListenerMiddleware();

    middleware(req as never, res as never, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();

    const allowed = { path: '/Internal/Log-Access/check/x' };
    capturedHandler(allowed as never, {});
    middleware(allowed as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);

    await listener.onApplicationShutdown();
    expect(mockServer.close).toHaveBeenCalled();
  });
});
