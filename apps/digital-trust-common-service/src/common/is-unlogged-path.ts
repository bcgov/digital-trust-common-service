import type { IncomingMessage } from 'node:http';

// Liveness and readiness are polled continuously by the kubelet, so a log
// line per probe is volume without signal. `health/status` is a
// human/monitoring endpoint rather than a probe, so it stays logged.
const UNLOGGED_PATHS = new Set(['/health/live', '/health/ready']);

// The express-specific field pino-http (and anything else inspecting the
// request) sees for the raw path before routing.
interface RoutedRequest extends IncomingMessage {
  originalUrl?: string;
}

export function isUnloggedPath(req: IncomingMessage): boolean {
  const { originalUrl } = req as RoutedRequest;
  const path = (originalUrl ?? req.url ?? '').split('?')[0];

  return UNLOGGED_PATHS.has(path);
}
