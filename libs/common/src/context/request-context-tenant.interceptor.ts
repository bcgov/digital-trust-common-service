import type { AuthenticatedRequest } from '@app/auth/types/express';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';

import { RequestContextService } from './request-context.service';

/**
 * Tenant and operation identifiers are UUIDs throughout the API — the routes
 * parse them with `ParseUUIDPipe`. Interceptors run after guards but the
 * value still originates from request/JWT input, so the shape is checked
 * before it is written into the correlation context that the logger and
 * adapter instrumentation read from.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Populates `tenantId` on the request's `RequestContextStore` once
 * `TenantGuard` (or an equivalent) has resolved it. Runs after guards, before
 * the handler, so the handler and everything it calls sees the tenant id in
 * the same context the request-id middleware already opened.
 */
@Injectable()
export class RequestContextTenantInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestContextTenantInterceptor.name);

  public constructor(private readonly requestContext: RequestContextService) {}

  public intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    try {
      this.populateTenantId(context);
    } catch (error) {
      // Must never affect request handling — this only enriches the
      // correlation context that downstream logging/tracing reads.
      this.logger.warn(
        'Failed to populate tenant id on request context',
        error instanceof Error ? error.stack : undefined,
      );
    }

    return next.handle();
  }

  private populateTenantId(context: ExecutionContext): void {
    if (context.getType() !== 'http') {
      return;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const tenantId = this.resolveTenantId(request);

    if (tenantId) {
      this.requestContext.setTenantId(tenantId);
    }
  }

  private resolveTenantId(request: AuthenticatedRequest): string | null {
    if (this.isTraceableId(request.tenantId)) {
      return request.tenantId;
    }

    const authTenantId = request.auth?.tenantId;
    if (this.isTraceableId(authTenantId)) {
      return authTenantId;
    }

    return null;
  }

  private isTraceableId(value: unknown): value is string {
    return typeof value === 'string' && UUID_PATTERN.test(value);
  }
}
