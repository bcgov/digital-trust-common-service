import { Writable } from 'node:stream';

import { RequestContextService } from '@app/common/context/request-context.service';
import { ConfigService } from '@nestjs/config';
import express from 'express';
import { type Logger as PinoLogger } from 'pino';
import pinoHttp from 'pino-http';

import { createRequestIdMiddleware } from '../../src/common/middleware/request-id.middleware';
import { createLoggerModuleParams } from '../../src/logging/logger.config';

export const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
export const TENANT_ID = '22222222-2222-4222-8222-222222222222';
export const OPERATION_ID = '33333333-3333-4333-8333-333333333333';

/**
 * Captures what the logger writes to its destination so a test can assert on
 * the bytes, not just on a mocked call. `chunks` is the raw output — use it to
 * prove a secret never reached the stream in any form; `records()` parses the
 * NDJSON for structural assertions.
 */
export class InMemoryStream extends Writable {
  public readonly chunks: string[] = [];

  public _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  public lines(): string[] {
    return this.chunks.join('').trim().split('\n').filter(Boolean);
  }

  public records(): Array<Record<string, unknown>> {
    return this.lines().map(
      (line) => JSON.parse(line) as Record<string, unknown>,
    );
  }
}

export function createLogger(
  logLevel: string | undefined,
  extras?: Record<string, string>,
): {
  logger: PinoLogger;
  requestContext: RequestContextService;
  stream: InMemoryStream;
} {
  const stream = new InMemoryStream();
  const requestContext = new RequestContextService();
  const params = createLoggerModuleParams(
    config(logLevel, extras),
    requestContext,
    stream,
  );
  const pinoHttp = params.pinoHttp as { logger: PinoLogger };

  return { logger: pinoHttp.logger, requestContext, stream };
}

export function config(
  logLevel: string | undefined,
  extras: Record<string, string> = {},
): ConfigService {
  return {
    get: (key: string) => (key === 'LOG_LEVEL' ? logLevel : extras[key]),
  } as ConfigService;
}

/**
 * Wires the logger the way `configureApp()` does — request-id middleware first
 * so the context is open before pino-http registers its response listener.
 */
export function createHttpApp(): {
  app: express.Express;
  stream: InMemoryStream;
} {
  const stream = new InMemoryStream();
  const requestContext = new RequestContextService();
  const params = createLoggerModuleParams(
    config('info'),
    requestContext,
    stream,
  );
  const app = express();

  app.use(createRequestIdMiddleware(requestContext));
  app.use(pinoHttp(params.pinoHttp as Parameters<typeof pinoHttp>[0]));
  app.get('/api/v1/tenants/:tenantId', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/health/live', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/health/ready', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/boom', (_req, _res, next) => {
    next(new Error('boom'));
  });

  return { app, stream };
}

// pino-http writes from a response-finish listener, which runs after supertest
// has resolved. Yielding once lets that listener land before the assertion.
export async function accessLogRecords(
  stream: InMemoryStream,
): Promise<Array<Record<string, unknown>>> {
  await new Promise((resolve) => setImmediate(resolve));

  return stream
    .records()
    .filter(
      (record) =>
        record.message === 'request completed' ||
        record.message === 'request failed',
    );
}
