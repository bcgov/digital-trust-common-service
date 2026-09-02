import type { AuthenticatedRequest } from '@app/auth/types/express';
import { Logger, type ExecutionContext } from '@nestjs/common';
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
  // Identifiers must be UUID-shaped to reach a span: interceptors run before
  // ParseUUIDPipe, so the raw path segment is all we have to go on.
  const ROUTE_TENANT_ID = '11111111-1111-4111-8111-111111111111';
  const CLAIM_TENANT_ID = '22222222-2222-4222-8222-222222222222';
  const OPERATION_ID = '33333333-3333-4333-8333-333333333333';

  const getActiveSpanMock = trace.getActiveSpan as jest.MockedFunction<
    typeof trace.getActiveSpan
  >;

  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
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
      tenantId: ROUTE_TENANT_ID,
    });

    expect(setAttribute).toHaveBeenCalledWith('tenant.id', ROUTE_TENANT_ID);
    expect(nextHandle).toHaveBeenCalledTimes(1);
    expect(result).toBe('handled');
  });

  it('sets tenant.id from the JWT tenant claim when route tenant is absent', async () => {
    const { nextHandle, result, setAttribute } = await runInterceptor({
      auth: { tenantId: CLAIM_TENANT_ID } as AuthenticatedRequest['auth'],
    });

    expect(setAttribute).toHaveBeenCalledWith('tenant.id', CLAIM_TENANT_ID);
    expect(nextHandle).toHaveBeenCalledTimes(1);
    expect(result).toBe('handled');
  });

  it('prefers the route tenant over the JWT tenant claim', async () => {
    const { nextHandle, result, setAttribute } = await runInterceptor({
      auth: { tenantId: CLAIM_TENANT_ID } as AuthenticatedRequest['auth'],
      tenantId: ROUTE_TENANT_ID,
    });

    expect(setAttribute).toHaveBeenCalledWith('tenant.id', ROUTE_TENANT_ID);
    expect(setAttribute).not.toHaveBeenCalledWith('tenant.id', CLAIM_TENANT_ID);
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
      params: { operationId: OPERATION_ID },
      tenantId: ROUTE_TENANT_ID,
    });

    expect(setAttribute).toHaveBeenCalledWith('tenant.id', ROUTE_TENANT_ID);
    expect(setAttribute).toHaveBeenCalledWith('operation.id', OPERATION_ID);
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
        getRequest: jest.fn(() => ({ tenantId: ROUTE_TENANT_ID })),
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
      { tenantId: ROUTE_TENANT_ID },
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
        getRequest: jest.fn(() => ({ tenantId: ROUTE_TENANT_ID })),
      })),
    } as unknown as ExecutionContext;

    const result = await lastValueFrom(
      interceptor.intercept(context, { handle: nextHandle }),
    );

    expect(setAttribute).toHaveBeenCalledWith('tenant.id', ROUTE_TENANT_ID);
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
      params: { operationId: OPERATION_ID },
      tenantId: ROUTE_TENANT_ID,
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
      ROUTE_TENANT_ID,
    );
    expect(serverSetAttribute).toHaveBeenCalledWith(
      'operation.id',
      OPERATION_ID,
    );
    expect(activeSetAttribute).not.toHaveBeenCalled();
    expect(nextHandle).toHaveBeenCalledTimes(1);
    expect(result).toBe('handled');
  });
  it('ignores an operation id that is not a UUID', async () => {
    const { nextHandle, result, setAttribute } = await runInterceptor({
      params: { operationId: '../../etc/passwd' },
      tenantId: ROUTE_TENANT_ID,
    });

    expect(setAttribute).toHaveBeenCalledWith('tenant.id', ROUTE_TENANT_ID);
    expect(setAttribute).not.toHaveBeenCalledWith(
      'operation.id',
      expect.any(String),
    );
    expect(nextHandle).toHaveBeenCalledTimes(1);
    expect(result).toBe('handled');
  });

  it('falls back to the JWT claim when the route tenant is not a UUID', async () => {
    const { setAttribute } = await runInterceptor({
      auth: { tenantId: CLAIM_TENANT_ID } as AuthenticatedRequest['auth'],
      tenantId: 'not-a-uuid',
    });

    expect(setAttribute).toHaveBeenCalledWith('tenant.id', CLAIM_TENANT_ID);
  });

  it('logs a warning when enrichment fails', async () => {
    const { nextHandle, result } = await runInterceptor({
      get tenantId(): string {
        throw new Error('request torn down');
      },
    } as Partial<AuthenticatedRequest>);

    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to enrich span with tenant context',
      expect.any(String),
    );
    expect(nextHandle).toHaveBeenCalledTimes(1);
    expect(result).toBe('handled');
  });
  it('logs without a stack when the failure is not an Error', async () => {
    const { nextHandle, result } = await runInterceptor({
      get tenantId(): string {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately non-Error, which is the branch under test
        throw 'request torn down';
      },
    } as Partial<AuthenticatedRequest>);

    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to enrich span with tenant context',
      undefined,
    );
    expect(nextHandle).toHaveBeenCalledTimes(1);
    expect(result).toBe('handled');
  });
});
