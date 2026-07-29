import { SetMetadata } from '@nestjs/common';

export const DEPRECATION_METADATA_KEY = 'api:deprecation';

export interface DeprecationOptions {
  /**
   * HTTP-date (RFC 7231) the route is scheduled to stop working, used to
   * populate the `Sunset` response header, e.g. `Tue, 31 Dec 2026 23:59:59 GMT`.
   */
  sunset?: string;
  /**
   * Optional URL pointing to migration/deprecation documentation, emitted as
   * a `Link: <url>; rel="deprecation"` response header.
   */
  link?: string;
}

/**
 * Marks a controller or route handler as deprecated (AG-01 D4).
 *
 * This is forward-looking scaffolding: no routes use it yet. When a future
 * API version supersedes a route, annotate it with `@Deprecated()` so
 * `DeprecationInterceptor` emits the `Deprecation`/`Sunset`/`Link` headers
 * without any additional plumbing.
 */
export const Deprecated = (options: DeprecationOptions = {}) =>
  SetMetadata(DEPRECATION_METADATA_KEY, options);
