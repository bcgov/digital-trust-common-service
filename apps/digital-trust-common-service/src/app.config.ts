import { RequestContextTenantInterceptor } from '@app/common/context/request-context-tenant.interceptor';
import { RequestContextService } from '@app/common/context/request-context.service';
import {
  ClassSerializerInterceptor,
  INestApplication,
  RequestMethod,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Express } from 'express';

import { API_PREFIX } from './common/constants/api-version.constants';
import { DeprecationInterceptor } from './common/interceptors/deprecation.interceptor';
import { createRequestIdMiddleware } from './common/middleware/request-id.middleware';

/**
 * Applies the global prefix/versioning setup (and other cross-cutting
 * app config) to a Nest application instance.
 *
 * Extracted from `bootstrap()` so both `main.ts` and e2e/integration tests
 * that build their own `INestApplication` via `Test.createTestingModule`
 * exercise the exact same routing configuration production traffic sees,
 * instead of drifting from it.
 */
export function configureApp(app: INestApplication): void {
  // Caddy (dev) and the OpenShift router (prod) both sit in front of the
  // app and set X-Forwarded-For/-Proto; `trustedProxies`
  // (charts/.../values.yaml) restricts which peers those headers are
  // honored from. Without `trust proxy`, `req.ip` (e.g. in
  // `RateLimitGuard`'s tracker) would resolve to the proxy's own address
  // for every caller instead of the real client IP.
  const expressInstance = app.getHttpAdapter().getInstance() as Express;
  expressInstance.set('trust proxy', true);

  // Raw `app.use()`, registered first, so every request — including
  // `health` and `oidc`, which sit outside the `/api` prefix below — gets a
  // correlation id and runs inside the `RequestContextService` store that
  // the logger and adapter instrumentation read from.
  app.use(createRequestIdMiddleware(app.get(RequestContextService)));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // `/api` prefix + explicit URI versioning (no defaultVersion).
  // Operational endpoints (health, root) are excluded so
  // they stay on a single stable, unversioned path. Swagger is
  // mounted separately via raw Express routes in SwaggerService and is
  // unaffected by this prefix.
  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: '/', method: RequestMethod.GET },
      { path: 'health', method: RequestMethod.ALL },
      { path: 'health/(.*)', method: RequestMethod.ALL },
      { path: 'oidc/(.*)', method: RequestMethod.ALL },
    ],
  });
  app.enableVersioning({
    type: VersioningType.URI,
  });

  const reflector = app.get(Reflector);
  app.useGlobalInterceptors(
    new DeprecationInterceptor(reflector),
    new ClassSerializerInterceptor(reflector),
    new RequestContextTenantInterceptor(app.get(RequestContextService)),
  );
}
