import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { Request, Response, Express, NextFunction } from 'express';

import { OidcProviderService } from './oidc-provider.service';

/**
 * Mounts the oidc-provider request handler at `/oidc` on the app's
 * underlying Express instance.
 *
 * `Provider` extends Koa internally, but `provider.callback()` returns a
 * plain Node request listener (`(req, res) => void`), confirmed via the
 * library's own source (`lib/helpers/oidc_context.js`, which documents
 * `expressApp.use('/op', provider.callback())` as the supported pattern).
 * No Koa-to-Express bridge is required; mounting it as raw middleware via
 * `app.use()` also keeps it outside Nest's controller pipeline entirely, so
 * the global `ValidationPipe`/guards never see `/oidc/*` requests.
 *
 * `mount()` must be callable right after `NestFactory.create()` and before
 * `app.listen()`, as `main.ts` does. `OidcProviderService.onModuleInit()`
 * (which builds the actual `Provider` instance) does not run until
 * `app.listen()`/`app.init()` is called (confirmed empirically: Nest defers
 * module lifecycle hooks until then, they do NOT run as part of `create()`).
 * Resolving `getProvider().callback()` eagerly here would therefore throw.
 * Instead, the Express handler registered below defers both lookups until
 * the first incoming request, by which point the app is fully initialized,
 * and caches the resulting callback for reuse on subsequent requests.
 */
export class OidcMountService {
  public static readonly MOUNT_PATH = '/oidc';

  private static readonly logger = new Logger(OidcMountService.name);

  public static mount(app: INestApplication): void {
    const oidcProviderService = app.get(OidcProviderService);

    // OpenShift terminates TLS at the router; without this, oidc-provider
    // would see plain HTTP and issue http:// discovery/token URLs. This is
    // the Express-level counterpart to `provider.proxy = true` (Koa-level,
    // see oidc-provider.service.ts); both are required.
    const expressInstance = app.getHttpAdapter().getInstance() as Express;
    expressInstance.set('trust proxy', true);

    let callback: ((req: Request, res: Response) => Promise<void>) | undefined;

    app.use(
      OidcMountService.MOUNT_PATH,
      (req: Request, res: Response, next: NextFunction): void => {
        // Let NestJS handle /oidc/interaction/* and /oidc/callback/* routes
        if (
          req.path.startsWith('/interaction') ||
          req.path.startsWith('/callback')
        ) {
          next();
          return;
        }

        callback ??= oidcProviderService.getProvider().callback();

        // Koa already catches errors thrown inside the middleware chain and
        // converts them into an HTTP response, so this does not handle the
        // normal error case. It guards the narrower gap where a rejection
        // escapes Koa entirely (e.g. after headers are sent), which would
        // otherwise be an unhandled promise rejection with no logging.
        void callback(req, res).catch((err: unknown) => {
          OidcMountService.logger.error(
            `Unhandled error in OIDC handler for ${req.method} ${req.originalUrl}`,
            err instanceof Error ? err.stack : String(err),
          );

          if (!res.headersSent) {
            res.statusCode = 500;
            res.end();
          }
        });
      },
    );
  }
}
