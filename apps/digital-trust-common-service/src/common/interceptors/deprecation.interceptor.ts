import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import {
  DEPRECATION_METADATA_KEY,
  DeprecationOptions,
} from '../decorators/deprecated.decorator';

/**
 * Emits `Deprecation`/`Sunset`/`Link` response headers for routes annotated
 * with `@Deprecated()` (AG-01 D4).
 *
 * This interceptor is wired globally but is currently inert: no controller
 * or handler uses `@Deprecated()` yet, so it never adds headers today. It
 * exists so the first real v2 transition needs zero new plumbing — just add
 * `@Deprecated({ sunset, link })` to the superseded route.
 */
@Injectable()
export class DeprecationInterceptor implements NestInterceptor {
  public constructor(private readonly reflector: Reflector) {}

  public intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<
      DeprecationOptions | undefined
    >(DEPRECATION_METADATA_KEY, [context.getHandler(), context.getClass()]);

    if (!options) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse<Response>();

        response.setHeader('Deprecation', 'true');

        if (options.sunset) {
          response.setHeader('Sunset', options.sunset);
        }

        if (options.link) {
          response.setHeader('Link', `<${options.link}>; rel="deprecation"`);
        }
      }),
    );
  }
}
