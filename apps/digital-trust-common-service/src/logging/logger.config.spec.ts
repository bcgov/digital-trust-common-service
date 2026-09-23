import { Writable } from 'node:stream';

import { RequestContextService } from '@app/common/context/request-context.service';
import { ConsoleLogger, Logger as NestLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import express from 'express';
import { LoggerModule, Logger as PinoNestLogger } from 'nestjs-pino';
import { type Logger as PinoLogger } from 'pino';
import pinoHttp from 'pino-http';
import request from 'supertest';

import { createRequestIdMiddleware } from '../common/middleware/request-id.middleware';

import { createLoggerModuleParams } from './logger.config';

class InMemoryStream extends Writable {
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

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const TENANT_ID = '22222222-2222-4222-8222-222222222222';
const OPERATION_ID = '33333333-3333-4333-8333-333333333333';

describe('createLoggerModuleParams', () => {
  afterEach(() => {
    NestLogger.overrideLogger(new ConsoleLogger());
  });

  it('emits valid JSON lines with the expected base fields', () => {
    const { logger, stream } = createLogger('info');

    logger.info({ context: 'ShapeLogger' }, 'hello world');

    expect(stream.lines()).toHaveLength(1);
    expect(() => {
      JSON.parse(stream.lines()[0]);
    }).not.toThrow();
    expect(stream.records()[0]).toMatchObject({
      context: 'ShapeLogger',
      level: 'log',
      message: 'hello world',
      service: 'digital-trust-common-service',
    });
    expect(stream.records()[0].timestamp).toEqual(expect.any(Number));
  });

  it('honours LOG_LEVEL when it is set to warn', () => {
    const { logger, stream } = createLogger('warn');

    logger.debug('debug suppressed');
    logger.info('info suppressed');
    logger.warn('warn emitted');
    logger.error('error emitted');

    expect(stream.records().map((record) => record.message)).toEqual([
      'warn emitted',
      'error emitted',
    ]);
  });

  it('defaults LOG_LEVEL to info when it is unset', () => {
    const { logger, stream } = createLogger(undefined);

    logger.debug('debug suppressed');
    logger.info('info emitted');

    expect(stream.records().map((record) => record.message)).toEqual([
      'info emitted',
    ]);
  });

  it('falls back to info and warns when LOG_LEVEL is unknown', () => {
    const stream = new InMemoryStream();

    expect(() =>
      createLoggerModuleParams(
        config('nonsense'),
        new RequestContextService(),
        stream,
      ),
    ).not.toThrow();

    expect(stream.records()[0]).toMatchObject({
      configuredLogLevel: 'nonsense',
      fallbackLogLevel: 'info',
      level: 'warn',
      message: 'Invalid LOG_LEVEL configured; falling back to info',
    });
  });

  it('preserves context from existing Nest Logger call sites', async () => {
    const stream = new InMemoryStream();
    const testingModule = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot(
          createLoggerModuleParams(
            config('info'),
            new RequestContextService(),
            stream,
          ),
        ),
      ],
    }).compile();

    NestLogger.overrideLogger(testingModule.get(PinoNestLogger));
    new NestLogger('Foo').log('x');
    await testingModule.close();

    expect(stream.records()[0]).toMatchObject({
      context: 'Foo',
      message: 'x',
    });
  });

  it('redacts top-level and nested secrets', () => {
    const { logger, stream } = createLogger('info');

    logger.info(
      {
        context: 'RedactionLogger',
        password: 'secret-password',
        req: {
          headers: {
            authorization: 'Bearer nested-token-value',
            'x-api-key': 'nested-api-key-value',
          },
        },
      },
      'redacted',
    );

    expect(stream.chunks.join('')).not.toContain('secret-password');
    expect(stream.chunks.join('')).not.toContain('nested-token-value');
    expect(stream.chunks.join('')).not.toContain('nested-api-key-value');
    expect(stream.records()[0]).toMatchObject({
      password: '[Redacted]',
      req: {
        headers: {
          authorization: '[Redacted]',
          'x-api-key': '[Redacted]',
        },
      },
    });
  });

  it('redacts secrets carried on error payloads', () => {
    const { logger, stream } = createLogger('info');
    const error = new Error('upstream failed') as Error & {
      response: {
        data: {
          access_token: string;
          credentialSubject: { givenName: string };
        };
      };
    };
    error.response = {
      data: {
        access_token: 'upstream-access-token',
        credentialSubject: { givenName: 'Alice' },
      },
    };

    logger.error({ context: 'ErrorLogger', err: error }, 'failed');

    expect(stream.chunks.join('')).not.toContain('upstream-access-token');
    expect(stream.chunks.join('')).not.toContain('Alice');
    expect(stream.records()[0]).toMatchObject({
      err: {
        response: {
          data: {
            access_token: '[Redacted]',
            credentialSubject: '[Redacted]',
          },
        },
      },
    });
  });

  it('does not throw when logging circular payloads', () => {
    const { logger, stream } = createLogger('info');
    const payload: Record<string, unknown> = { context: 'CircularLogger' };
    payload.self = payload;

    expect(() => logger.info(payload, 'circular')).not.toThrow();
    expect(stream.records()[0]).toMatchObject({ message: 'circular' });
  });

  it('leaves output as JSON when LOG_PRETTY is unset', () => {
    const { logger, stream } = createLogger('info');

    logger.info({ context: 'JsonLogger' }, 'structured');

    expect(() => {
      JSON.parse(stream.lines()[0]);
    }).not.toThrow();
  });

  it('falls back to JSON with a warning when pino-pretty is unavailable', () => {
    const stream = new InMemoryStream();

    // doMock registers in the mock registry, which outlives isolateModules.
    // Without this cleanup every later LOG_PRETTY test silently gets the
    // throwing stub and asserts against JSON it did not ask for.
    try {
      jest.isolateModules(() => {
        jest.doMock('pino-pretty', () => {
          throw new Error("Cannot find module 'pino-pretty'");
        });

        const { createLoggerModuleParams: create } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('./logger.config') as typeof import('./logger.config');
        const pinoHttp = create(
          config('info', { LOG_PRETTY: 'true' }),
          new RequestContextService(),
          stream,
        ).pinoHttp as { logger: PinoLogger };

        pinoHttp.logger.info({ context: 'FallbackLogger' }, 'structured');
      });
    } finally {
      jest.dontMock('pino-pretty');
      jest.resetModules();
    }

    expect(stream.records()).toMatchObject([
      {
        level: 'warn',
        message:
          'LOG_PRETTY is enabled but pino-pretty is not installed; falling back to JSON output',
      },
      { context: 'FallbackLogger', message: 'structured' },
    ]);
  });

  it('renders pretty output when LOG_PRETTY is true', () => {
    const { logger, stream } = createLogger('info', { LOG_PRETTY: 'true' });

    logger.info({ context: 'PrettyLogger' }, 'human readable');

    const output = stripAnsi(stream.chunks.join(''));

    expect(output).toContain('LOG:');
    expect(output).toContain('[PrettyLogger] human readable');
    expect(() => {
      JSON.parse(output);
    }).toThrow();
  });

  it('keeps redaction intact in pretty output', () => {
    const { logger, stream } = createLogger('info', { LOG_PRETTY: 'true' });

    logger.info(
      { access_token: 'upstream-access-token', context: 'PrettyLogger' },
      'redacted',
    );

    const output = stripAnsi(stream.chunks.join(''));

    expect(output).not.toContain('upstream-access-token');
    expect(output).toContain('[Redacted]');
  });

  it('ignores LOG_PRETTY values other than true', () => {
    const { logger, stream } = createLogger('info', { LOG_PRETTY: 'yes' });

    logger.info({ context: 'JsonLogger' }, 'structured');

    expect(() => {
      JSON.parse(stream.lines()[0]);
    }).not.toThrow();
  });
});

describe('request correlation fields', () => {
  it('omits correlation fields when no request context is open', () => {
    const { logger, stream } = createLogger('info');

    logger.info('startup');

    const record = stream.records()[0];
    expect(record).not.toHaveProperty('request_id');
    expect(record).not.toHaveProperty('source');
    expect(record).not.toHaveProperty('tenant_id');
    expect(record).not.toHaveProperty('operation_id');
  });

  it('attaches the request id and source to every line in a request', () => {
    const { logger, requestContext, stream } = createLogger('info');

    requestContext.run({ requestId: REQUEST_ID, source: 'api' }, () => {
      logger.info('first');
      logger.info('second');
    });

    expect(stream.records()).toMatchObject([
      { request_id: REQUEST_ID, source: 'api' },
      { request_id: REQUEST_ID, source: 'api' },
    ]);
  });

  it('attaches tenant and operation ids once they are resolved', () => {
    const { logger, requestContext, stream } = createLogger('info');

    requestContext.run({ requestId: REQUEST_ID, source: 'api' }, () => {
      logger.info('before resolution');
      requestContext.setTenantId(TENANT_ID);
      requestContext.setOperationId(OPERATION_ID);
      logger.info('after resolution');
    });

    const [before, after] = stream.records();
    expect(before).not.toHaveProperty('tenant_id');
    expect(before).not.toHaveProperty('operation_id');
    expect(after).toMatchObject({
      operation_id: OPERATION_ID,
      tenant_id: TENANT_ID,
    });
  });

  it('names the queue a background job came from', () => {
    const { logger, requestContext, stream } = createLogger('info');

    requestContext.run(
      { requestId: REQUEST_ID, source: 'job:audit.write' },
      () => {
        logger.info('writing audit row');
      },
    );

    expect(stream.records()[0]).toMatchObject({
      request_id: REQUEST_ID,
      source: 'job:audit.write',
    });
  });

  it('omits the request id for a job nobody requested', () => {
    const { logger, requestContext, stream } = createLogger('info');

    requestContext.run({ source: 'job:audit.partition-maintain' }, () => {
      logger.info('maintaining partitions');
    });

    const record = stream.records()[0];
    expect(record).toMatchObject({ source: 'job:audit.partition-maintain' });
    expect(record).not.toHaveProperty('request_id');
  });
});

describe('access log', () => {
  it('emits one line per request with the route pattern, not the path', async () => {
    const { app, stream } = createHttpApp();

    await request(app).get(`/api/v1/tenants/${TENANT_ID}`).expect(200);

    const accessLogs = await accessLogRecords(stream);
    expect(accessLogs).toHaveLength(1);
    expect(accessLogs[0]).toMatchObject({
      method: 'GET',
      route: '/api/v1/tenants/:tenantId',
      status_code: 200,
    });
    expect(typeof accessLogs[0].duration_ms).toBe('number');
  });

  it('correlates the access log with the request it describes', async () => {
    const { app, stream } = createHttpApp();

    await request(app)
      .get(`/api/v1/tenants/${TENANT_ID}`)
      .set('X-Request-Id', REQUEST_ID)
      .expect(200);

    // The access log is written from a response-finish listener, so this also
    // covers the request context surviving past the handler.
    expect((await accessLogRecords(stream))[0]).toMatchObject({
      request_id: REQUEST_ID,
      source: 'api',
    });
  });

  it('keeps headers and bodies out of the access log', async () => {
    const { app, stream } = createHttpApp();

    await request(app)
      .get(`/api/v1/tenants/${TENANT_ID}`)
      .set('Authorization', 'Bearer super-secret-token')
      .set('Cookie', 'session=super-secret-session')
      .expect(200);

    const [accessLog] = await accessLogRecords(stream);
    expect(accessLog).not.toHaveProperty('req');
    expect(accessLog).not.toHaveProperty('res');
    expect(JSON.stringify(accessLog)).not.toContain('super-secret');
  });

  it('records an unmatched request without echoing the path back', async () => {
    const { app, stream } = createHttpApp();

    await request(app).get('/api/v1/../../etc/passwd').expect(404);

    const [accessLog] = await accessLogRecords(stream);
    expect(accessLog).toMatchObject({ method: 'GET', status_code: 404 });
    expect(accessLog).not.toHaveProperty('route');
    expect(JSON.stringify(accessLog)).not.toContain('passwd');
  });

  it('does not log liveness and readiness probes', async () => {
    const { app, stream } = createHttpApp();

    await request(app).get('/health/live').expect(200);
    await request(app).get('/health/ready').expect(200);

    expect(await accessLogRecords(stream)).toHaveLength(0);
  });

  it('logs a server error as an error-level access log', async () => {
    const { app, stream } = createHttpApp();

    await request(app).get('/boom').expect(500);

    expect((await accessLogRecords(stream))[0]).toMatchObject({
      level: 'error',
      message: 'request failed',
      status_code: 500,
    });
  });
});

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/**
 * pino-pretty colourises when the environment advertises colour support, which
 * CI does. Strip the escapes so assertions match the text either way.
 */
function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '');
}

function createLogger(
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

function config(
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
function createHttpApp(): {
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
async function accessLogRecords(
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
