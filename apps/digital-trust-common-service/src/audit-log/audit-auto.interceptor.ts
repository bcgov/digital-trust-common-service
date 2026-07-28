import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';

import { AuditAction, AuditActorType } from './audit-log.entity';
import { AuditWriteWorker } from './audit-write.worker';
import { SKIP_AUTO_AUDIT_KEY } from './skip-auto-audit.decorator';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const SKIP_PATH_PREFIXES = ['/health', '/api/docs', '/api/docs/'];

@Injectable()
export class AuditAutoInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditAutoInterceptor.name);

  public constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
    private readonly auditWriteWorker: AuditWriteWorker,
  ) {}

  public intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    if (!this.isEnabled()) {
      return next.handle();
    }

    if (context.getType() !== 'http') {
      return next.handle();
    }

    const skip =
      this.reflector.getAllAndOverride<boolean>(SKIP_AUTO_AUDIT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true;

    if (skip) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const method = (request.method ?? '').toUpperCase();

    if (!MUTATING_METHODS.has(method)) {
      return next.handle();
    }

    const path = request.path ?? request.url ?? '';
    if (this.shouldSkipPath(path)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: () => {
          void this.enqueueSafe(request, method, path);
        },
      }),
    );
  }

  private isEnabled(): boolean {
    return (
      this.config.get<string>('AUDIT_AUTO_INTERCEPTOR_ENABLED', 'false') ===
      'true'
    );
  }

  private shouldSkipPath(path: string): boolean {
    if (path.includes('/audit-logs')) {
      return true;
    }
    return SKIP_PATH_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(prefix),
    );
  }

  private async enqueueSafe(
    request: Request,
    method: string,
    path: string,
  ): Promise<void> {
    try {
      const tenantId = this.resolveTenantId(request);
      if (!tenantId) {
        this.logger.debug(
          `Skipping auto-audit for ${method} ${path}: missing tenantId`,
        );
        return;
      }

      const resourceId = this.resolveResourceId(request);
      if (!resourceId) {
        this.logger.debug(
          `Skipping auto-audit for ${method} ${path}: missing resourceId`,
        );
        return;
      }

      await this.auditWriteWorker.enqueue({
        tenantId,
        actorId: 'system',
        actorType: AuditActorType.SYSTEM,
        action: this.mapAction(method),
        resourceType: this.mapResourceType(path),
        resourceId,
        metadata: {
          source: 'auto-interceptor',
          method,
          path,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Auto-audit enqueue failed for ${method} ${path}: ${message}`,
      );
    }
  }

  private resolveTenantId(request: Request): string | null {
    const params = request.params ?? {};
    if (typeof params.tenantId === 'string' && params.tenantId) {
      return params.tenantId;
    }
    const body = request.body as { tenantId?: string } | undefined;
    if (typeof body?.tenantId === 'string' && body.tenantId) {
      return body.tenantId;
    }
    return null;
  }

  private resolveResourceId(request: Request): string | null {
    const params = request.params ?? {};
    if (typeof params.id === 'string' && params.id) {
      return params.id;
    }
    // Creates without a path id are covered by domain producers; skip rather than
    // inventing a stand-in resourceId that would mis-attribute rows.
    return null;
  }

  private mapAction(method: string): AuditAction {
    switch (method) {
      case 'POST':
        return AuditAction.CREATE;
      case 'PUT':
      case 'PATCH':
        return AuditAction.UPDATE;
      case 'DELETE':
        return AuditAction.DELETE;
      default:
        return AuditAction.UPDATE;
    }
  }

  private mapResourceType(path: string): string {
    const segment = path.split('/').filter(Boolean)[0] ?? 'unknown';
    return segment.replace(/-/g, '_');
  }
}
