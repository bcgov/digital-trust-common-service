import { randomUUID } from 'node:crypto';

import { RequestContextService } from '@app/common/context/request-context.service';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';

// Accepts the shape of a client-supplied correlation id (own UUIDs included)
// without accepting arbitrary/oversized input into logs, traces, and pg-boss
// job data — anything else is replaced with a freshly generated UUIDv4.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Applied via `app.use()` in `configureApp()` rather than as a `NestMiddleware`
 * class so it runs ahead of Nest's routing/global-prefix handling and covers
 * every path, including `health` and `oidc`, which are excluded from the
 * global `/api` prefix.
 */
export function createRequestIdMiddleware(
  requestContext: RequestContextService,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const requestId = resolveRequestId(
      req.headers[REQUEST_ID_HEADER.toLowerCase()],
    );
    res.setHeader(REQUEST_ID_HEADER, requestId);

    requestContext.run({ requestId }, () => next());
  };
}

function resolveRequestId(headerValue: string | string[] | undefined): string {
  const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (candidate && REQUEST_ID_PATTERN.test(candidate)) {
    return candidate;
  }

  return randomUUID();
}
