import { CallHandler, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { of, throwError } from 'rxjs';

import { AuditAutoInterceptor } from './audit-auto.interceptor';
import { AuditAction } from './audit-log.entity';
import { AuditWriteWorker } from './audit-write.worker';
import { SKIP_AUTO_AUDIT_KEY } from './skip-auto-audit.decorator';

describe('AuditAutoInterceptor', () => {
  let interceptor: AuditAutoInterceptor;
  let mockEnqueue: jest.Mock;
  let mockGet: jest.Mock;
  let mockReflectorGet: jest.Mock;

  beforeEach(() => {
    mockEnqueue = jest.fn().mockResolvedValue('job-1');
    mockGet = jest.fn((_key: string, fallback?: string) => fallback);
    mockReflectorGet = jest.fn().mockReturnValue(undefined);

    interceptor = new AuditAutoInterceptor(
      { get: mockGet } as unknown as ConfigService,
      { getAllAndOverride: mockReflectorGet } as unknown as Reflector,
      { enqueue: mockEnqueue } as unknown as AuditWriteWorker,
    );
  });

  const httpContext = (request: Record<string, unknown>): ExecutionContext =>
    ({
      getType: () => 'http',
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    }) as unknown as ExecutionContext;

  it('does nothing when flag is disabled', (done) => {
    mockGet.mockImplementation((key: string, fallback?: string) =>
      key === 'AUDIT_AUTO_INTERCEPTOR_ENABLED' ? 'false' : fallback,
    );

    interceptor
      .intercept(httpContext({ method: 'POST', path: '/things', params: {} }), {
        handle: () => of({ ok: true }),
      } as CallHandler)
      .subscribe({
        complete: () => {
          expect(mockEnqueue).not.toHaveBeenCalled();
          done();
        },
      });
  });

  it('skips handlers marked with SkipAutoAudit', (done) => {
    mockGet.mockImplementation((key: string, fallback?: string) =>
      key === 'AUDIT_AUTO_INTERCEPTOR_ENABLED' ? 'true' : fallback,
    );
    mockReflectorGet.mockImplementation((key: string) =>
      key === SKIP_AUTO_AUDIT_KEY ? true : undefined,
    );

    interceptor
      .intercept(
        httpContext({
          method: 'POST',
          path: '/tenants',
          params: {},
          body: { tenantId: '123e4567-e89b-12d3-a456-426614174001' },
        }),
        { handle: () => of({ ok: true }) } as CallHandler,
      )
      .subscribe({
        complete: () => {
          expect(mockEnqueue).not.toHaveBeenCalled();
          done();
        },
      });
  });

  it('enqueues after successful mutating requests when enabled', (done) => {
    mockGet.mockImplementation((key: string, fallback?: string) =>
      key === 'AUDIT_AUTO_INTERCEPTOR_ENABLED' ? 'true' : fallback,
    );

    interceptor
      .intercept(
        httpContext({
          method: 'DELETE',
          path: '/widgets/123e4567-e89b-12d3-a456-426614174099',
          params: {
            tenantId: '123e4567-e89b-12d3-a456-426614174001',
            id: '123e4567-e89b-12d3-a456-426614174099',
          },
        }),
        { handle: () => of({ ok: true }) } as CallHandler,
      )
      .subscribe({
        complete: () => {
          setTimeout(() => {
            expect(mockEnqueue).toHaveBeenCalledWith(
              expect.objectContaining({
                action: AuditAction.DELETE,
                resourceType: 'widgets',
                resourceId: '123e4567-e89b-12d3-a456-426614174099',
              }),
            );
            done();
          }, 0);
        },
      });
  });

  it('skips POST creates without a path resource id', (done) => {
    mockGet.mockImplementation((key: string, fallback?: string) =>
      key === 'AUDIT_AUTO_INTERCEPTOR_ENABLED' ? 'true' : fallback,
    );

    interceptor
      .intercept(
        httpContext({
          method: 'POST',
          path: '/widgets',
          params: {},
          body: { tenantId: '123e4567-e89b-12d3-a456-426614174001' },
        }),
        { handle: () => of({ ok: true }) } as CallHandler,
      )
      .subscribe({
        complete: () => {
          setTimeout(() => {
            expect(mockEnqueue).not.toHaveBeenCalled();
            done();
          }, 0);
        },
      });
  });

  it('skips health paths', (done) => {
    mockGet.mockImplementation((key: string, fallback?: string) =>
      key === 'AUDIT_AUTO_INTERCEPTOR_ENABLED' ? 'true' : fallback,
    );

    interceptor
      .intercept(
        httpContext({
          method: 'POST',
          path: '/health',
          params: { tenantId: '123e4567-e89b-12d3-a456-426614174001' },
        }),
        { handle: () => of({ ok: true }) } as CallHandler,
      )
      .subscribe({
        complete: () => {
          expect(mockEnqueue).not.toHaveBeenCalled();
          done();
        },
      });
  });

  it('does not enqueue when the handler errors', (done) => {
    mockGet.mockImplementation((key: string, fallback?: string) =>
      key === 'AUDIT_AUTO_INTERCEPTOR_ENABLED' ? 'true' : fallback,
    );

    interceptor
      .intercept(
        httpContext({
          method: 'POST',
          path: '/widgets',
          params: {},
          body: { tenantId: '123e4567-e89b-12d3-a456-426614174001' },
        }),
        {
          handle: () => throwError(() => new Error('boom')),
        } as CallHandler,
      )
      .subscribe({
        error: () => {
          expect(mockEnqueue).not.toHaveBeenCalled();
          done();
        },
      });
  });
});
