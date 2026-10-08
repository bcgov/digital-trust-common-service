import type { IncomingMessage } from 'node:http';

// The express-specific fields visible on the request. `route` is only
// populated once a handler has matched.
interface RoutedRequest extends IncomingMessage {
  baseUrl?: string;
  route?: { path?: string };
}

/**
 * The matched route pattern, never the request path: the path carries tenant
 * and operation ids, and on an unmatched request it is arbitrary client
 * input. Returns `undefined` when nothing matched, so callers log method and
 * status but no route rather than something unbounded.
 */
export function resolveRoute(req: IncomingMessage): string | undefined {
  const { baseUrl, route } = req as RoutedRequest;

  if (typeof route?.path !== 'string') {
    return undefined;
  }

  const resolved = `${typeof baseUrl === 'string' ? baseUrl : ''}${route.path}`;

  return resolved === '' ? undefined : resolved;
}
