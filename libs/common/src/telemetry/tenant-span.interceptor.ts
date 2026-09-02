import type { AuthenticatedRequest } from '@app/auth/types/express';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { Observable } from 'rxjs';

import { getServerSpan } from './server-span';

const OPERATION_ID_ATTRIBUTE = 'operation.id';
const TENANT_ID_ATTRIBUTE = 'tenant.id';

/**
 * Tenant and operation identifiers are UUIDs throughout the API — the routes
 * parse them with `ParseUUIDPipe`. Interceptors run before pipes, so what is
 * read here is still raw URL input: a request that will be rejected with a 400
 * moments later can carry any path segment at all. Checking the shape first
 * keeps malformed or oversized values from reaching the tracing backend, where
 * attributes are indexed for search.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantSpanInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenantSpanInterceptor.name);

  public intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    try {
      this.enrichSpan(context);
    } catch (error) {
      // Enrichment must never affect request handling, but reaching here means
      // a defect in enrichment itself rather than a bad request, so it is worth
      // seeing in production rather than swallowing.
      this.logger.warn(
        'Failed to enrich span with tenant context',
        error instanceof Error ? error.stack : undefined,
      );
    }

    return next.handle();
  }

  private enrichSpan(context: ExecutionContext): void {
    if (context.getType() !== 'http') {
      return;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // Prefer the HTTP server span. The span active here is a nested express or
    // Nest handler span, which trace search by root span — and any dashboard
    // built on it — will not see. Falling back keeps enrichment working if the
    // server span was never recorded.
    const span = getServerSpan(request) ?? trace.getActiveSpan();
    if (!span) {
      return;
    }

    const tenantId = this.resolveTenantId(request);
    const operationId = this.resolveOperationId(request);

    this.setAttribute(span, TENANT_ID_ATTRIBUTE, tenantId);
    this.setAttribute(span, OPERATION_ID_ATTRIBUTE, operationId);
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

  private resolveOperationId(request: AuthenticatedRequest): string | null {
    const operationId = request.params?.operationId;

    return this.isTraceableId(operationId) ? operationId : null;
  }

  private isTraceableId(value: unknown): value is string {
    return typeof value === 'string' && UUID_PATTERN.test(value);
  }

  private setAttribute(
    span: NonNullable<ReturnType<typeof trace.getActiveSpan>>,
    name: string,
    value: string | null,
  ): void {
    if (!value) {
      return;
    }

    span.setAttribute(name, value);
  }
}
