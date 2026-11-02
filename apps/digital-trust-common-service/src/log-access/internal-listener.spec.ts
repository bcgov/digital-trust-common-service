import type { IncomingMessage } from 'http';

import { ExecutionContext, NotFoundException } from '@nestjs/common';

import { createInternalListenerMiddleware } from './internal-listener';
import { InternalListenerGuard } from './internal-listener.guard';

describe('internal listener', () => {
  it('guard answers 404 for a request not on the internal listener', () => {
    const context = {
      switchToHttp: () => ({ getRequest: () => ({}) as IncomingMessage }),
    } as unknown as ExecutionContext;

    expect(() => new InternalListenerGuard().canActivate(context)).toThrow(
      NotFoundException,
    );
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
});
