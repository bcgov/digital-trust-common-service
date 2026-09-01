import type { AuthenticatedRequest } from '@app/auth/types/express';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { Observable } from 'rxjs';

import { getServerSpan } from './server-span';

const OPERATION_ID_ATTRIBUTE = 'operation.id';
const TENANT_ID_ATTRIBUTE = 'tenant.id';

@Injectable()
export class TenantSpanInterceptor implements NestInterceptor {
  public intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    try {
      this.enrichSpan(context);
    } catch {
      // Telemetry enrichment must never affect request handling.
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

    this.setAttributeSafe(span, TENANT_ID_ATTRIBUTE, tenantId);
    this.setAttributeSafe(span, OPERATION_ID_ATTRIBUTE, operationId);
  }

  private resolveTenantId(request: AuthenticatedRequest): string | null {
    if (this.hasAttributeValue(request.tenantId)) {
      return request.tenantId;
    }

    const authTenantId = request.auth?.tenantId;
    if (this.hasAttributeValue(authTenantId)) {
      return authTenantId;
    }

    return null;
  }

  private resolveOperationId(request: AuthenticatedRequest): string | null {
    const operationId = request.params?.operationId;
    if (this.hasAttributeValue(operationId)) {
      return operationId;
    }

    return null;
  }

  private hasAttributeValue(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
  }

  private setAttributeSafe(
    span: NonNullable<ReturnType<typeof trace.getActiveSpan>>,
    name: string,
    value: string | null,
  ): void {
    if (!value) {
      return;
    }

    try {
      span.setAttribute(name, value);
    } catch {
      // Telemetry enrichment must never affect request handling.
    }
  }
}
