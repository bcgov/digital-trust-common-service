import {
  All,
  Controller,
  Headers,
  Logger,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';

import { InternalListenerGuard } from './internal-listener.guard';
import { LogAccessDeniedError } from './log-access-denied.error';
import { LOG_ACCESS_INTERNAL_PATH, SCOPE_HEADER } from './log-access.constants';
import { LogAccessService } from './log-access.service';

const DENIAL_BODIES = {
  401: { error: 'unauthorized' },
  403: { error: 'forbidden' },
} as const;

/**
 * Decision endpoint for Envoy's `ext_authz` filter in HTTP mode. Reachable
 * only on the internal listener and deliberately outside the versioned API
 * and the OpenAPI document: tenants must never call it.
 *
 * The caller's query, path and every header except `Authorization` are
 * ignored. Allow is a `200` with an empty body carrying the
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
    @Res() res: Response,
  ): Promise<void> {
    // A caller-supplied partition header is recorded and ignored.
    if (inboundScope !== undefined) {
      this.logger.warn('Inbound scope header ignored');
    }

    try {
      const scope = await this.service.resolveScope(authorization);

      res.status(200).setHeader(SCOPE_HEADER, scope).end();
    } catch (error) {
      if (!(error instanceof LogAccessDeniedError)) {
        this.logger.error('Unexpected error evaluating log access');
        res.status(403).json(DENIAL_BODIES[403]);
        return;
      }

      this.logger.warn(`Log access denied: ${error.reason}`);
      res.status(error.status).json(DENIAL_BODIES[error.status]);
    }
  }
}
