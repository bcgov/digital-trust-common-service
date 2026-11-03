import { readFileSync } from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';
import { createServer, type Server } from 'https';

import {
  Injectable,
  Logger,
  type INestApplication,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { LOG_ACCESS_INTERNAL_PATH } from './log-access.constants';

const internalRequests = new WeakSet<IncomingMessage>();

/** True only for requests accepted by the internal listener. */
export function isInternalRequest(req: IncomingMessage): boolean {
  return internalRequests.has(req);
}

/**
 * Keeps the internal listener to the decision endpoint. The endpoint itself
 * refuses requests that did not arrive on that listener, so the two ports
 * stay disjoint even for path spellings this check does not anticipate.
 */
export function createInternalListenerMiddleware(): RequestHandler {
  const prefix = `/${LOG_ACCESS_INTERNAL_PATH}`;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isInternalRequest(req)) {
      next();
      return;
    }

    const path = req.path.toLowerCase();

    if (path === prefix || path.startsWith(`${prefix}/`)) {
      next();
      return;
    }

    res.status(404).json({ error: 'not_found' });
  };
}

/**
 * Serves the Nest application a second time over TLS on a private port. The
 * token it carries never crosses a plaintext hop, and no Route or
 * Ingress points at the port.
 */
@Injectable()
export class InternalListener implements OnApplicationShutdown {
  private readonly logger = new Logger(InternalListener.name);
  private server?: Server;

  public constructor(private readonly config: ConfigService) {}

  public async start(app: INestApplication): Promise<void> {
    const port = this.config.get<string>('LOG_ACCESS_INTERNAL_PORT')?.trim();

    if (!port) {
      return;
    }

    const certPath = this.config.getOrThrow<string>(
      'LOG_ACCESS_INTERNAL_TLS_CERT_PATH',
    );
    const keyPath = this.config.getOrThrow<string>(
      'LOG_ACCESS_INTERNAL_TLS_KEY_PATH',
    );

    await app.init();

    const handler = app.getHttpAdapter().getInstance() as (
      req: IncomingMessage,
      res: ServerResponse,
    ) => void;

    const server = createServer(
      { cert: readFileSync(certPath), key: readFileSync(keyPath) },
      (req, res) => {
        internalRequests.add(req);
        handler(req, res);
      },
    );

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(parseInt(port, 10), resolve);
    });

    this.server = server;
    this.logger.log(`Internal log access listener on port ${port}`);
  }

  public async onApplicationShutdown(): Promise<void> {
    const server = this.server;

    if (!server) {
      return;
    }

    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
