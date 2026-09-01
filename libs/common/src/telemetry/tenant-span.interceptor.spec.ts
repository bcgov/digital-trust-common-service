import type { AuthenticatedRequest } from '@app/auth/types/express';
import type { ExecutionContext } from '@nestjs/common';
import { trace, type Span } from '@opentelemetry/api';
import { lastValueFrom, of } from 'rxjs';

import { rememberServerSpan } from './server-span';
import { TenantSpanInterceptor } from './tenant-span.interceptor';

jest.mock('@opentelemetry/api', () => ({
  trace: {
    getActiveSpan: jest.fn(),
  },
}));

describe('TenantSpanInterceptor', () => {
  const getActiveSpanMock = trace.getActiveSpan as jest.MockedFunction<
    typeof trace.getActiveSpan
  >;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  async function runInterceptor(
    request: Partial<AuthenticatedRequest>,
    contextType: 'http' | 'rpc' = 'http',
  ): Promise<{
    readonly result: string;
    readonly setAttribute: jest.Mock;
    readonly nextHandle: jest.Mock;
  }> {
    const interceptor = new TenantSpanInterceptor();
    const setAttribute = jest.fn();
    getActiveSpanMock.mockReturnValue({
      setAttribute,
    } as ReturnType<typeof trace.getActiveSpan>);

    const nextHandle = jest.fn(() => of('handled'));
    const context = {
      getType: jest.fn(() => contextType),
      switchToHttp: jest.fn(() => ({
        getRequest: jest.fn(() => request),
      })),
    } as unknown as ExecutionContext;

    const result = await lastValueFrom(
      interceptor.intercept(context, { handle: nextHandle }),
    );

    return { nextHandle, result, setAttribute };
  }

  it('sets tenant.id from the route tenant', async () => {
    const { nextHandle, result, setAttribute } = await runInterceptor({
      tenantId: 'route-tenant',
    });

    expect(setAttribute).toHaveBeenCalledWith('tenant.id', 'route-tenant');
    expect(nextHandle).toHaveBeenCalledTimes(1);
    expect(result).toBe('handled');
  });

  it('sets tenant.id from the JWT tenant claim when route tenant is absent', async () => {
    const { nextHandle, result, setAttribute } = await runInterceptor({
      auth: { tenantId: 'claim-tenant' } as AuthenticatedRequest['auth'],
    });

    expect(setAttribute).toHaveBeenCalledWith('tenant.id', 'claim-tenant');
    expect(nextHandle).toHaveBeenCalledTimes(1);
    expect(result).toBe('handled');
  });

  it('prefers the route tenant over the JWT tenant claim', async () => {
    const { nextHandle, result, setAttribute } = await runInterceptor({
      auth: { tenantId: 'claim-tenant' } as AuthenticatedRequest['auth'],
      tenantId: 'route-tenant',
    });

    expect(setAttribute).toHaveBeenCalledWith('tenant.id', 'route-tenant');
    expect(setAttribute).not.toHaveBeenCalledWith('tenant.id', 'claim-tenant');
    expect(nextHandle).toHaveBeenCalledTimes(1);
    expect(result).toBe('handled');
  });

  it('does not set tenant.id when the tenant is unknown', async () => {
    const { nextHandle, result, setAttribute } = await runInterceptor({});

    expect(setAttribute).not.toHaveBeenCalledWith(
      'tenant.id',
      expect.any(String),
    );
    expect(nextHandle).toHaveBeenCalledTimes(1);
    expect(result).toBe('handled');
  });

  it('sets operation.id from the operation route parameter', async () => {
    const { nextHandle, result, setAttribute } = await runInterceptor({
      params: { operationId: 'operation-1' },
      tenantId: 'route-tenant',
    });

    expect(setAttribute).toHaveBeenCalledWith('tenant.id', 'route-tenant');
    expect(setAttribute).toHaveBeenCalledWith('operation.id', 'operation-1');
    expect(nextHandle).toHaveBeenCalledTimes(1);
    expect(result).toBe('handled');
  });

  it('passes the request through when there is no active span', async () => {
    const interceptor = new TenantSpanInterceptor();
    getActiveSpanMock.mockReturnValue(undefined);
    const nextHandle = jest.fn(() => of('handled'));
    const context = {
      getType: jest.fn(() => 'http'),
      switchToHttp: jest.fn(() => ({
        getRequest: jest.fn(() => ({ tenantId: 'route-tenant' })),
      })),
    } as unknown as ExecutionContext;

    const result = await lastValueFrom(
      interceptor.intercept(context, { handle: nextHandle }),
    );

    expect(nextHandle).toHaveBeenCalledTimes(1);
    expect(result).toBe('handled');
  });

  it('passes the request through for non-HTTP execution contexts', async () => {
    const { nextHandle, result, setAttribute } = await runInterceptor(
      { tenantId: 'route-tenant' },
      'rpc',
    );

    expect(getActiveSpanMock).not.toHaveBeenCalled();
    expect(setAttribute).not.toHaveBeenCalled();
    expect(nextHandle).toHaveBeenCalledTimes(1);
    expect(result).toBe('handled');
  });

  it('passes the request through when setting an attribute fails', async () => {
    const interceptor = new TenantSpanInterceptor();
    const setAttribute = jest.fn(() => {
      throw new Error('span closed');
    });
    getActiveSpanMock.mockReturnValue({
      setAttribute,
    } as ReturnType<typeof trace.getActiveSpan>);
    const nextHandle = jest.fn(() => of('handled'));
    const context = {
      getType: jest.fn(() => 'http'),
      switchToHttp: jest.fn(() => ({
        getRequest: jest.fn(() => ({ tenantId: 'route-tenant' })),
      })),
    } as unknown as ExecutionContext;

    const result = await lastValueFrom(
      interceptor.intercept(context, { handle: nextHandle }),
    );

    expect(setAttribute).toHaveBeenCalledWith('tenant.id', 'route-tenant');
    expect(nextHandle).toHaveBeenCalledTimes(1);
    expect(result).toBe('handled');
  });
  it('sets attributes on the HTTP server span rather than the active span', async () => {
    const interceptor = new TenantSpanInterceptor();
    const serverSetAttribute = jest.fn();
    const activeSetAttribute = jest.fn();

    getActiveSpanMock.mockReturnValue({
      setAttribute: activeSetAttribute,
    } as ReturnType<typeof trace.getActiveSpan>);

    const request: Partial<AuthenticatedRequest> = {
      params: { operationId: 'operation-1' },
      tenantId: 'route-tenant',
    };
    rememberServerSpan(request, {
      setAttribute: serverSetAttribute,
    } as unknown as Span);

    const nextHandle = jest.fn(() => of('handled'));
    const context = {
      getType: jest.fn(() => 'http'),
      switchToHttp: jest.fn(() => ({
        getRequest: jest.fn(() => request),
      })),
    } as unknown as ExecutionContext;

    const result = await lastValueFrom(
      interceptor.intercept(context, { handle: nextHandle }),
    );

    expect(serverSetAttribute).toHaveBeenCalledWith(
      'tenant.id',
      'route-tenant',
    );
    expect(serverSetAttribute).toHaveBeenCalledWith(
      'operation.id',
      'operation-1',
    );
    expect(activeSetAttribute).not.toHaveBeenCalled();
    expect(nextHandle).toHaveBeenCalledTimes(1);
    expect(result).toBe('handled');
  });
});
