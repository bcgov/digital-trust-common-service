import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';

jest.mock('argon2', () => ({
  hash: jest.fn(),
  verify: jest.fn(),
  argon2i: 'argon2i',
}));
jest.mock('jose', () => ({}));
jest.mock('oidc-provider', () => ({ default: class FakeProvider {} }));

import { OidcMountService } from './oidc-mount.service';
import { OidcProviderService } from './oidc-provider.service';

describe('OidcMountService', () => {
  it('registers a lazy /oidc handler and enables trust proxy, without resolving the provider at mount time', () => {
    const callback = jest.fn();
    const provider = { callback: jest.fn().mockReturnValue(callback) };
    const oidcProviderService = {
      getProvider: jest.fn().mockReturnValue(provider),
    };

    const set = jest.fn();
    const expressInstance = { set };
    const getInstance = jest.fn().mockReturnValue(expressInstance);
    const getHttpAdapter = jest.fn().mockReturnValue({ getInstance });

    const get = jest.fn().mockReturnValue(oidcProviderService);
    const use = jest.fn();

    const app = {
      get,
      getHttpAdapter,
      use,
    } as unknown as INestApplication;

    OidcMountService.mount(app);

    expect(get).toHaveBeenCalledWith(OidcProviderService);
    expect(set).toHaveBeenCalledWith('trust proxy', true);
    expect(use).toHaveBeenCalledWith('/oidc', expect.any(Function));
    // The whole point of deferring: mount() must not need the provider to
    // already be initialized (see main.ts, which calls mount() before
    // app.listen(), the point at which onModuleInit() actually runs).
    expect(oidcProviderService.getProvider).not.toHaveBeenCalled();
    expect(provider.callback).not.toHaveBeenCalled();
  });

  it('logs and sends a 500 when the callback promise rejects and headers are not sent', async () => {
    const error = new Error('boom');
    const callback = jest.fn().mockRejectedValue(error);
    const provider = { callback: jest.fn().mockReturnValue(callback) };
    const oidcProviderService = {
      getProvider: jest.fn().mockReturnValue(provider),
    };

    const app = {
      get: jest.fn().mockReturnValue(oidcProviderService),
      getHttpAdapter: jest.fn().mockReturnValue({
        getInstance: jest.fn().mockReturnValue({ set: jest.fn() }),
      }),
      use: jest.fn(),
    } as unknown as INestApplication;

    const loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    OidcMountService.mount(app);

    const [, handler] = (app.use as jest.Mock).mock.calls[0] as [
      string,
      (req: unknown, res: unknown) => void,
    ];

    const req = { method: 'GET', originalUrl: '/oidc/token', path: '/token' };
    const res = { headersSent: false, statusCode: 200, end: jest.fn() };

    handler(req, res);

    await new Promise((resolve) => process.nextTick(resolve));

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('GET /oidc/token'),
      error.stack,
    );
    expect(res.statusCode).toBe(500);
    expect(res.end).toHaveBeenCalled();

    loggerErrorSpy.mockRestore();
  });

  it('logs but does not touch the response when the callback rejects after headers are sent', async () => {
    const error = new Error('boom');
    const callback = jest.fn().mockRejectedValue(error);
    const provider = { callback: jest.fn().mockReturnValue(callback) };
    const oidcProviderService = {
      getProvider: jest.fn().mockReturnValue(provider),
    };

    const app = {
      get: jest.fn().mockReturnValue(oidcProviderService),
      getHttpAdapter: jest.fn().mockReturnValue({
        getInstance: jest.fn().mockReturnValue({ set: jest.fn() }),
      }),
      use: jest.fn(),
    } as unknown as INestApplication;

    const loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    OidcMountService.mount(app);

    const [, handler] = (app.use as jest.Mock).mock.calls[0] as [
      string,
      (req: unknown, res: unknown) => void,
    ];

    const req = { method: 'GET', originalUrl: '/oidc/token', path: '/token' };
    const res = { headersSent: true, statusCode: 200, end: jest.fn() };

    handler(req, res);

    await new Promise((resolve) => process.nextTick(resolve));

    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);

    loggerErrorSpy.mockRestore();
  });

  it('resolves the provider callback lazily on the first request and reuses it afterwards', () => {
    const callback = jest.fn().mockResolvedValue(undefined);
    const provider = { callback: jest.fn().mockReturnValue(callback) };
    const oidcProviderService = {
      getProvider: jest.fn().mockReturnValue(provider),
    };

    const app = {
      get: jest.fn().mockReturnValue(oidcProviderService),
      getHttpAdapter: jest.fn().mockReturnValue({
        getInstance: jest.fn().mockReturnValue({ set: jest.fn() }),
      }),
      use: jest.fn(),
    } as unknown as INestApplication;

    OidcMountService.mount(app);

    const [, handler] = (app.use as jest.Mock).mock.calls[0] as [
      string,
      (req: unknown, res: unknown) => void,
    ];

    const req1 = { id: 'req1', path: '/token' };
    const res1 = { id: 'res1' };
    handler(req1, res1);

    const req2 = { id: 'req2', path: '/token' };
    const res2 = { id: 'res2' };
    handler(req2, res2);

    expect(oidcProviderService.getProvider).toHaveBeenCalledTimes(1);
    expect(provider.callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenNthCalledWith(1, req1, res1);
    expect(callback).toHaveBeenNthCalledWith(2, req2, res2);
  });

  it('propagates the "not initialized" error only once a request actually arrives', () => {
    const oidcProviderService = {
      getProvider: jest.fn().mockImplementation(() => {
        throw new Error('OIDC provider has not been initialized yet.');
      }),
    };

    const app = {
      get: jest.fn().mockReturnValue(oidcProviderService),
      getHttpAdapter: jest.fn().mockReturnValue({
        getInstance: jest.fn().mockReturnValue({ set: jest.fn() }),
      }),
      use: jest.fn(),
    } as unknown as INestApplication;

    expect(() => OidcMountService.mount(app)).not.toThrow();

    const [, handler] = (app.use as jest.Mock).mock.calls[0] as [
      string,
      (req: unknown, res: unknown) => void,
    ];

    expect(() => handler({ path: '/token' }, {})).toThrow(
      'OIDC provider has not been initialized yet.',
    );
  });

  it('calls next() for /interaction routes without invoking the callback', () => {
    const callback = jest.fn();
    const provider = { callback: jest.fn().mockReturnValue(callback) };
    const oidcProviderService = {
      getProvider: jest.fn().mockReturnValue(provider),
    };

    const app = {
      get: jest.fn().mockReturnValue(oidcProviderService),
      getHttpAdapter: jest.fn().mockReturnValue({
        getInstance: jest.fn().mockReturnValue({ set: jest.fn() }),
      }),
      use: jest.fn(),
    } as unknown as INestApplication;

    OidcMountService.mount(app);

    const [, handler] = (app.use as jest.Mock).mock.calls[0] as [
      string,
      (req: unknown, res: unknown) => void,
    ];

    const next = jest.fn();
    const req = { path: '/interaction/uid-123' };
    const res = {};

    handler(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });

  it('calls next() for /callback routes without invoking the callback', () => {
    const callback = jest.fn();
    const provider = { callback: jest.fn().mockReturnValue(callback) };
    const oidcProviderService = {
      getProvider: jest.fn().mockReturnValue(provider),
    };

    const app = {
      get: jest.fn().mockReturnValue(oidcProviderService),
      getHttpAdapter: jest.fn().mockReturnValue({
        getInstance: jest.fn().mockReturnValue({ set: jest.fn() }),
      }),
      use: jest.fn(),
    } as unknown as INestApplication;

    OidcMountService.mount(app);

    const [, handler] = (app.use as jest.Mock).mock.calls[0] as [
      string,
      (req: unknown, res: unknown) => void,
    ];

    const next = jest.fn();
    const req = { path: '/callback' };
    const res = {};

    handler(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });

  it('invokes the callback for non-interaction/callback OIDC routes', async () => {
    const callback = jest.fn().mockResolvedValue(undefined);
    const provider = { callback: jest.fn().mockReturnValue(callback) };
    const oidcProviderService = {
      getProvider: jest.fn().mockReturnValue(provider),
    };

    const app = {
      get: jest.fn().mockReturnValue(oidcProviderService),
      getHttpAdapter: jest.fn().mockReturnValue({
        getInstance: jest.fn().mockReturnValue({ set: jest.fn() }),
      }),
      use: jest.fn(),
    } as unknown as INestApplication;

    OidcMountService.mount(app);

    const [, handler] = (app.use as jest.Mock).mock.calls[0] as [
      string,
      (req: unknown, res: unknown) => void,
    ];

    const next = jest.fn();
    const req = { path: '/token' };
    const res = {};

    handler(req, res, next);

    await new Promise((resolve) => process.nextTick(resolve));

    expect(callback).toHaveBeenCalledWith(req, res);
    expect(next).not.toHaveBeenCalled();
  });
});
