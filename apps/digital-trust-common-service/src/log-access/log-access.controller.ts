import {
  All,
  Controller,
  Headers,
  Logger,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { InternalListenerGuard } from './internal-listener.guard';
import { LogAccessDeniedError } from './log-access-denied.error';
import {
  LOG_ACCESS_INTERNAL_PATH,
  SCOPE_HEADER,
  TENANT_SELECTING_PARAMETERS,
} from './log-access.constants';
import { LogAccessService } from './log-access.service';

const DENIAL_BODIES = {
  401: { error: 'unauthorized' },
  403: { error: 'forbidden' },
  429: { error: 'too_many_requests' },
} as const;

/**
 * Decision endpoint for Envoy's `ext_authz` filter in HTTP mode. Reachable
 * only on the internal listener and deliberately outside the versioned API
 * and the OpenAPI document: tenants must never call it.
 *
 * The caller's query, path and every header except `Authorization` are
 * ignored; a tenant-selecting query parameter is only recorded. Allow is a `200` with an empty body carrying the
 * computed scope header; every denial for a given status has one fixed body.
 */
@ApiExcludeController()
@SkipThrottle()
@UseGuards(InternalListenerGuard)
@Controller(LOG_ACCESS_INTERNAL_PATH)
export class LogAccessController {
  private readonly logger = new Logger(LogAccessController.name);

  public constructor(private readonly service: LogAccessService) {}

  @All('{*path}')
  public async check(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-scope-orgid') inboundScope: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // A caller-supplied partition header is recorded and ignored.
    if (inboundScope !== undefined) {
      this.logger.warn('Inbound scope header ignored');
    }

    const ignored = this.findTenantSelectingParameters(req);
    if (ignored.length > 0) {
      this.logger.warn(
        `Tenant-selecting query parameter ignored: ${ignored.join(', ')}`,
      );
    }

    try {
      const scope = await this.service.resolveScope(authorization);

      res.status(200).setHeader(SCOPE_HEADER, scope).end();
    } catch (error) {
      if (!(error instanceof LogAccessDeniedError)) {
        throw error;
      }

      this.logger.warn(`Log access denied: ${error.reason}`);
      res.status(error.status).json(DENIAL_BODIES[error.status]);
    }
  }

  // Reports recognised names only, never caller-supplied text or values.
  private findTenantSelectingParameters(req: Request): string[] {
    const forwarded = [
      req.headers['x-envoy-original-path'],
      req.headers['x-original-uri'],
    ];
    const found = new Set<string>();

    for (const raw of [req.originalUrl, ...forwarded]) {
      const url = Array.isArray(raw) ? raw[0] : raw;
      const queryStart = url?.indexOf('?') ?? -1;

      if (url === undefined || queryStart < 0) {
        continue;
      }

      const query = url.slice(queryStart + 1).split('#')[0];

      for (const [name] of new URLSearchParams(query)) {
        const normalised = name.toLowerCase();

        if (TENANT_SELECTING_PARAMETERS.has(normalised)) {
          found.add(normalised);
        }
      }
    }

    return [...found];
  }
}
