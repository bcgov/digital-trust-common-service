import { AuthenticationRequiredException } from '@app/auth';
import { RequestContextService } from '@app/common/context/request-context.service';
import {
  ArgumentsHost,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { GlobalExceptionFilter } from './global-exception.filter';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function buildHost(): {
  host: ArgumentsHost;
  status: jest.Mock;
  json: jest.Mock;
  setHeader: jest.Mock;
} {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const setHeader = jest.fn();
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status, setHeader }),
      getRequest: () => ({ method: 'GET', url: '/api/v1/tenants/123' }),
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json, setHeader };
}

function buildFilter(nodeEnv: string): {
  filter: GlobalExceptionFilter;
  requestContext: RequestContextService;
} {
  const requestContext = new RequestContextService();
  const config = {
    get: jest.fn((_key: string, fallback?: string) =>
      _key === 'NODE_ENV' ? nodeEnv : fallback,
    ),
  } as unknown as ConfigService;

  return {
    filter: new GlobalExceptionFilter(requestContext, config),
    requestContext,
  };
}

describe('GlobalExceptionFilter', () => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('preserves an already-shaped auth exception body and adds the WWW-Authenticate header', () => {
    const { filter, requestContext } = buildFilter('production');
    const { host, status, json, setHeader } = buildHost();
    const exception = new AuthenticationRequiredException(
      'invalid_token',
      'token expired',
    );

    requestContext.run({ requestId: REQUEST_ID, source: 'api' }, () => {
      filter.catch(exception, host);
    });

    expect(setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      exception.getWwwAuthenticateHeader(),
    );
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Bearer token is missing, expired, or invalid',
        request_id: REQUEST_ID,
      },
    });
    expect(warnSpy).toHaveBeenCalled();
  });

  it('derives a generic fallback code for a plain NotFoundException', () => {
    const { filter, requestContext } = buildFilter('production');
    const { host, status, json } = buildHost();

    requestContext.run({ requestId: REQUEST_ID, source: 'api' }, () => {
      filter.catch(new NotFoundException('Tenant not found'), host);
    });

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'RESOURCE_NOT_FOUND',
        message: 'Tenant not found',
        request_id: REQUEST_ID,
      },
    });
  });

  it('derives DUPLICATE_RESOURCE for a plain ConflictException', () => {
    const { filter, requestContext } = buildFilter('production');
    const { host, status, json } = buildHost();

    requestContext.run({ requestId: REQUEST_ID, source: 'api' }, () => {
      filter.catch(new ConflictException('Tenant slug already exists'), host);
    });

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'DUPLICATE_RESOURCE',
        message: 'Tenant slug already exists',
        request_id: REQUEST_ID,
      },
    });
  });

  it('masks a non-HttpException as a generic 500 and logs the stack', () => {
    const { filter, requestContext } = buildFilter('production');
    const { host, status, json } = buildHost();
    const exception = new Error('connection string leaked here');

    requestContext.run({ requestId: REQUEST_ID, source: 'api' }, () => {
      filter.catch(exception, host);
    });

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
        request_id: REQUEST_ID,
      },
    });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unhandled exception'),
      exception.stack,
    );
  });

  it('appends a stack-trace detail outside production', () => {
    const { filter, requestContext } = buildFilter('development');
    const { host, json } = buildHost();
    const exception = new NotFoundException('Tenant not found');

    requestContext.run({ requestId: REQUEST_ID, source: 'api' }, () => {
      filter.catch(exception, host);
    });

    const body = json.mock.calls[0][0] as {
      error: { details?: Array<{ message?: string }> };
    };
    expect(body.error.details).toEqual([{ message: exception.stack }]);
  });

  it('omits details in production', () => {
    const { filter, requestContext } = buildFilter('production');
    const { host, json } = buildHost();

    requestContext.run({ requestId: REQUEST_ID, source: 'api' }, () => {
      filter.catch(new NotFoundException('Tenant not found'), host);
    });

    const body = json.mock.calls[0][0] as { error: { details?: unknown } };
    expect(body.error.details).toBeUndefined();
  });

  it('omits request_id when no request context is active', () => {
    const { filter } = buildFilter('production');
    const { host, json } = buildHost();

    filter.catch(new NotFoundException('Tenant not found'), host);

    const body = json.mock.calls[0][0] as { error: { request_id?: string } };
    expect(body.error.request_id).toBeUndefined();
  });
});
