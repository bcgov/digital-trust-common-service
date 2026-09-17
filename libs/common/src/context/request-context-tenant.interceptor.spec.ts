import type { AuthenticatedRequest } from '@app/auth/types/express';
import { Logger, type ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';

import { RequestContextTenantInterceptor } from './request-context-tenant.interceptor';
import { RequestContextService } from './request-context.service';

describe('RequestContextTenantInterceptor', () => {
  // Identifiers must be UUID-shaped: interceptors run before ParseUUIDPipe,
  // so the raw path segment/claim is all we have to go on.
  const ROUTE_TENANT_ID = '11111111-1111-4111-8111-111111111111';
  const CLAIM_TENANT_ID = '22222222-2222-4222-8222-222222222222';

  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function buildContext(
    request: Partial<AuthenticatedRequest>,
    contextType: 'http' | 'rpc' = 'http',
  ): { context: ExecutionContext; nextHandle: jest.Mock } {
    const nextHandle = jest.fn(() => of('handled'));
    const context = {
      getType: jest.fn(() => contextType),
      switchToHttp: jest.fn(() => ({
        getRequest: jest.fn(() => request),
      })),
    } as unknown as ExecutionContext;

    return { context, nextHandle };
  }

  it('sets the tenant id from the route tenant', async () => {
    const requestContext = new RequestContextService();
    const interceptor = new RequestContextTenantInterceptor(requestContext);
    const { context, nextHandle } = buildContext({
      tenantId: ROUTE_TENANT_ID,
    });

    await requestContext.run({ requestId: 'req-1' }, async () => {
      const result = await lastValueFrom(
        interceptor.intercept(context, { handle: nextHandle }),
      );

      expect(result).toBe('handled');
      expect(requestContext.getTenantId()).toBe(ROUTE_TENANT_ID);
    });
  });

  it('falls back to the JWT tenant claim when the route tenant is absent', async () => {
    const requestContext = new RequestContextService();
    const interceptor = new RequestContextTenantInterceptor(requestContext);
    const { context, nextHandle } = buildContext({
      auth: { tenantId: CLAIM_TENANT_ID } as AuthenticatedRequest['auth'],
    });

    await requestContext.run({ requestId: 'req-1' }, async () => {
      await lastValueFrom(
        interceptor.intercept(context, { handle: nextHandle }),
      );
      expect(requestContext.getTenantId()).toBe(CLAIM_TENANT_ID);
    });
  });

  it('prefers the route tenant over the JWT claim', async () => {
    const requestContext = new RequestContextService();
    const interceptor = new RequestContextTenantInterceptor(requestContext);
    const { context, nextHandle } = buildContext({
      auth: { tenantId: CLAIM_TENANT_ID } as AuthenticatedRequest['auth'],
      tenantId: ROUTE_TENANT_ID,
    });

    await requestContext.run({ requestId: 'req-1' }, async () => {
      await lastValueFrom(
        interceptor.intercept(context, { handle: nextHandle }),
      );
      expect(requestContext.getTenantId()).toBe(ROUTE_TENANT_ID);
    });
  });

  it('ignores a non-UUID-shaped tenant id', async () => {
    const requestContext = new RequestContextService();
    const interceptor = new RequestContextTenantInterceptor(requestContext);
    const { context, nextHandle } = buildContext({
      tenantId: 'not-a-uuid',
    });

    await requestContext.run({ requestId: 'req-1' }, async () => {
      await lastValueFrom(
        interceptor.intercept(context, { handle: nextHandle }),
      );
      expect(requestContext.getTenantId()).toBeUndefined();
    });
  });

  it('is a no-op for non-http contexts', async () => {
    const requestContext = new RequestContextService();
    const interceptor = new RequestContextTenantInterceptor(requestContext);
    const { context, nextHandle } = buildContext(
      { tenantId: ROUTE_TENANT_ID },
      'rpc',
    );

    await requestContext.run({ requestId: 'req-1' }, async () => {
      await lastValueFrom(
        interceptor.intercept(context, { handle: nextHandle }),
      );
      expect(requestContext.getTenantId()).toBeUndefined();
    });
  });

  it('logs a warning and still calls next() when resolution throws', async () => {
    const requestContext = new RequestContextService();
    const interceptor = new RequestContextTenantInterceptor(requestContext);
    const nextHandle = jest.fn(() => of('handled'));
    const context = {
      getType: jest.fn(() => {
        throw new Error('boom');
      }),
    } as unknown as ExecutionContext;

    const result = await lastValueFrom(
      interceptor.intercept(context, { handle: nextHandle }),
    );

    expect(result).toBe('handled');
    expect(warnSpy).toHaveBeenCalled();
  });
});
