import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable } from '@nestjs/common';

import type { RequestContextStore } from './request-context.interface';

/**
 * Wraps a single, app-wide `AsyncLocalStorage` instance. Registered as a
 * default-scoped (singleton) provider so the request-id middleware, the
 * tenant-resolution interceptor, and any service that enqueues a pg-boss job
 * all share the same store for the duration of one request.
 */
@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContextStore>();

  public run<T>(store: RequestContextStore, callback: () => T): T {
    return this.storage.run(store, callback);
  }

  public get(): RequestContextStore | undefined {
    return this.storage.getStore();
  }

  public getRequestId(): string | undefined {
    return this.get()?.requestId;
  }

  public getTenantId(): string | undefined {
    return this.get()?.tenantId;
  }

  public setTenantId(tenantId: string): void {
    const store = this.get();
    if (store) {
      store.tenantId = tenantId;
    }
  }

  public getOperationId(): string | undefined {
    return this.get()?.operationId;
  }

  public setOperationId(operationId: string): void {
    const store = this.get();
    if (store) {
      store.operationId = operationId;
    }
  }
}
