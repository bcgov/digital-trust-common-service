import { RequestContextService } from '@app/common/context/request-context.service';
import { ConsoleLogger, Logger as NestLogger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LoggerModule, Logger as PinoNestLogger } from 'nestjs-pino';
import request from 'supertest';

import {
  accessLogRecords,
  config,
  createHttpApp,
  createLogger,
  InMemoryStream,
  OPERATION_ID,
  REQUEST_ID,
  TENANT_ID,
} from '../../test/support/logger-harness';

import { createLoggerModuleParams } from './logger.config';

/**
 * The fields the platform Alloy/Loki pipeline parses out of our stdout, and the
 * redaction backstop that keeps secrets out of them. Both are contracts with
 * something outside this repository — a collector pipeline on one side, an
 * incident on the other — so they are asserted here as a set rather than left
 * to the incidental coverage of the behaviour tests in `logger.config.spec.ts`.
 *
 * Scope: the fields the logger adds by itself, on ordinary lines and on access
 * logs. A call site is free to log fields of its own — the LOG_LEVEL fallback
 * warning does exactly that — and those belong to the call site, not here.
 */

// Present on every line, whatever produced it.
const BASE_FIELDS = ['level', 'message', 'pid', 'service', 'timestamp'];

// Allowed on a line but not required: `context` comes from the Nest logger,
// and the correlation fields only exist inside a request or job context.
const OPTIONAL_FIELDS = [
  'context',
  'operation_id',
  'request_id',
  'source',
  'tenant_id',
];

// pino's own defaults that must not survive our configuration: `hostname` is a
// node identifier the collector already knows, and `time`/`msg`/`v` are the
// field names we renamed. A dependency upgrade reintroducing any of them
// changes what the pipeline sees, so name them rather than infer them.
const FORBIDDEN_FIELDS = ['hostname', 'msg', 'time', 'v'];

// The access log replaces the logged object wholesale rather than serializing
// `req`/`res`, so these four are the entire addition — and the reason no header
// or body can reach it. `route` is absent when nothing matched.
const ACCESS_LOG_FIELDS = ['duration_ms', 'method', 'route', 'status_code'];

// Injected by the OpenTelemetry pino instrumentation when a span is recording.
// Not active under Jest — see `test/trace-log-correlation.e2e-spec.ts` — but
// named so this contract does not fail the moment it is.
const TRACE_FIELDS = ['span_id', 'trace_flags', 'trace_id'];

describe('structured log schema', () => {
  afterEach(() => {
    NestLogger.overrideLogger(new ConsoleLogger());
  });

  it('carries the base fields on a line with no context at all', () => {
    const { logger, stream } = createLogger('info');

    logger.info('starting up');

    expect(fieldsOf(stream.records()[0])).toEqual(BASE_FIELDS);
  });

  it('adds only correlation fields to a line logged during a request', () => {
    const { logger, requestContext, stream } = createLogger('info');

    requestContext.run({ requestId: REQUEST_ID, source: 'api' }, () => {
      requestContext.setTenantId(TENANT_ID);
      requestContext.setOperationId(OPERATION_ID);
      logger.info({ context: 'TenantService' }, 'tenant resolved');
    });

    expect(fieldsOf(stream.records()[0])).toEqual([
      'context',
      'level',
      'message',
      'operation_id',
      'pid',
      'request_id',
      'service',
      'source',
      'tenant_id',
      'timestamp',
    ]);
  });

  it('adds only the queue name to a line logged during a job', () => {
    const { logger, requestContext, stream } = createLogger('info');

    requestContext.run({ source: 'job:audit.partition-maintain' }, () => {
      logger.info('maintaining partitions');
    });

    expect(fieldsOf(stream.records()[0])).toEqual([
      'level',
      'message',
      'pid',
      'service',
      'source',
      'timestamp',
    ]);
  });

  it('adds no field of its own beyond the contract', () => {
    const { logger, requestContext, stream } = createLogger('trace');
    const allowed = new Set([
      ...BASE_FIELDS,
      ...OPTIONAL_FIELDS,
      ...TRACE_FIELDS,
    ]);

    logger.info('startup');
    requestContext.run({ requestId: REQUEST_ID, source: 'api' }, () => {
      logger.trace('trace');
      logger.debug('debug');
      logger.warn('warn');
      logger.error('error');
      logger.fatal('fatal');
    });

    const unexpected = stream
      .records()
      .flatMap((record) => fieldsOf(record))
      .filter((field) => !allowed.has(field));

    expect(unexpected).toEqual([]);
  });

  it.each(FORBIDDEN_FIELDS)('does not emit the pino %s field', (field) => {
    const { logger, stream } = createLogger('info');

    logger.info('any line');

    expect(stream.records()[0]).not.toHaveProperty(field);
  });

  it('labels every level with the name Nest uses, not a number', () => {
    const { logger, stream } = createLogger('trace');

    logger.trace('a');
    logger.debug('b');
    logger.info('c');
    logger.warn('d');
    logger.error('e');
    logger.fatal('f');

    expect(stream.records().map((record) => record.level)).toEqual([
      'verbose',
      'debug',
      'log',
      'warn',
      'error',
      'fatal',
    ]);
  });

  it('timestamps in epoch milliseconds', () => {
    const before = Date.now();
    const { logger, stream } = createLogger('info');

    logger.info('now');

    const { timestamp } = stream.records()[0];
    expect(typeof timestamp).toBe('number');
    expect(timestamp as number).toBeGreaterThanOrEqual(before);
    expect(timestamp as number).toBeLessThanOrEqual(Date.now());
  });

  // Alloy splits stdout on newlines before parsing, so a record that spans two
  // lines is not a badly formatted record — it is two malformed ones, and the
  // half carrying the correlation fields is the half that gets dropped.
  it('keeps a multi-line message on a single line', () => {
    const { logger, stream } = createLogger('info');

    logger.error(
      { context: 'StackLogger' },
      'failed\n    at first()\n    at second()',
    );

    expect(stream.lines()).toHaveLength(1);
    expect(stream.records()[0]).toMatchObject({
      message: 'failed\n    at first()\n    at second()',
    });
  });

  it('keeps the schema intact for lines from the Nest logger', async () => {
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
    new NestLogger('Bootstrap').log('Nest application successfully started');
    await testingModule.close();

    expect(fieldsOf(stream.records()[0])).toEqual(['context', ...BASE_FIELDS]);
  });
});

describe('access log schema', () => {
  it('adds exactly the four access-log fields to a matched request', async () => {
    const { app, stream } = createHttpApp();

    await request(app)
      .get(`/api/v1/tenants/${TENANT_ID}`)
      .set('X-Request-Id', REQUEST_ID)
      .set('Authorization', '******')
      .expect(200);

    const [accessLog] = await accessLogRecords(stream);
    expect(fieldsOf(accessLog)).toEqual([
      'duration_ms',
      'level',
      'message',
      'method',
      'pid',
      'request_id',
      'route',
      'service',
      'source',
      'status_code',
      'timestamp',
    ]);
  });

  // `logger.config.spec.ts` asserts that `req` and `res` specifically stay out.
  // Naming the whole set is what makes that durable: a serializer added by a
  // pino-http upgrade arrives under some other key, and only an exact
  // comparison notices.
  it('drops the route rather than adding fields when nothing matched', async () => {
    const { app, stream } = createHttpApp();

    await request(app).get('/api/v1/nothing-here').expect(404);

    const [accessLog] = await accessLogRecords(stream);
    expect(fieldsOf(accessLog)).toEqual(
      expectedAccessLogFields().filter((field) => field !== 'route'),
    );
  });

  it('keeps the same shape when the request failed', async () => {
    const { app, stream } = createHttpApp();

    await request(app).get('/boom').expect(500);

    const [accessLog] = await accessLogRecords(stream);
    expect(fieldsOf(accessLog)).toEqual(expectedAccessLogFields());
    expect(accessLog).toMatchObject({ level: 'error' });
  });

  it('reports the duration as a number of milliseconds', async () => {
    const { app, stream } = createHttpApp();

    await request(app).get(`/api/v1/tenants/${TENANT_ID}`).expect(200);

    const [accessLog] = await accessLogRecords(stream);
    expect(typeof accessLog.duration_ms).toBe('number');
    expect(accessLog.duration_ms as number).toBeGreaterThanOrEqual(0);
  });
});

describe('redaction', () => {
  afterEach(() => {
    NestLogger.overrideLogger(new ConsoleLogger());
  });

  const configuredKeys = redactedKeys();
  const nestingDepth = configuredNestingDepth();

  it('configures a non-empty set of keys to redact', () => {
    expect(configuredKeys.length).toBeGreaterThan(0);
  });

  it.each(configuredKeys)('redacts a top-level %s', (key) => {
    const { logger, stream } = createLogger('info');
    const secret = `top-level-${key}-value`;

    logger.info({ [key]: secret, context: 'RedactionLogger' }, 'logged');

    expect(stream.chunks.join('')).not.toContain(secret);
    expect(stream.records()[0][key]).toBe('[Redacted]');
  });

  it.each(configuredKeys)('redacts a nested %s', (key) => {
    const { logger, stream } = createLogger('info');
    const secret = `nested-${key}-value`;

    logger.info(
      { context: 'RedactionLogger', outer: { inner: { [key]: secret } } },
      'logged',
    );

    expect(stream.chunks.join('')).not.toContain(secret);
    expect(stream.records()[0]).toMatchObject({
      outer: { inner: { [key]: '[Redacted]' } },
    });
  });

  it('redacts a secret at the deepest configured nesting level', () => {
    const { logger, stream } = createLogger('info');

    logger.info(nest(nestingDepth, 'deep-enough'), 'logged');

    expect(stream.chunks.join('')).not.toContain('deep-enough');
  });

  // The wildcard paths are enumerated to a fixed depth, so this is where the
  // backstop stops — silently. Asserting the leak keeps the limit visible: if
  // something starts logging payloads this deep, the fix is to stop logging
  // them, not to add another wildcard level.
  it('does not reach a secret nested past the configured depth', () => {
    const { logger, stream } = createLogger('info');

    logger.info(nest(nestingDepth + 1, 'too-deep'), 'logged');

    expect(stream.chunks.join('')).toContain('too-deep');
  });

  it('redacts a secret carried inside an array', () => {
    const { logger, stream } = createLogger('info');

    logger.info(
      {
        context: 'RedactionLogger',
        clients: [{ client_secret: 'array-element-secret' }],
      },
      'logged',
    );

    expect(stream.chunks.join('')).not.toContain('array-element-secret');
  });

  // Redaction matches a key exactly, so it cannot cover every spelling of
  // every secret. It is a backstop for a mistake, not the control: the control
  // is choosing what to log. See the redaction rules in docs/ARCHITECTURE.md.
  it('does not catch a key whose spelling is not configured', () => {
    const { logger, stream } = createLogger('info');

    logger.info(
      { context: 'RedactionLogger', walletSeed: 'unlisted-key-value' },
      'logged',
    );

    expect(stream.chunks.join('')).toContain('unlisted-key-value');
  });

  it('redacts secrets logged through the Nest logger', async () => {
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
    new NestLogger('TokenService').log({
      access_token: 'nest-logger-token',
      message: 'issued token',
    });
    await testingModule.close();

    expect(stream.chunks.join('')).not.toContain('nest-logger-token');
  });

  it('redacts rather than dropping the key, so the shape survives', () => {
    const { logger, stream } = createLogger('info');

    logger.info(
      { context: 'RedactionLogger', password: 'value', username: 'alice' },
      'logged',
    );

    expect(stream.records()[0]).toMatchObject({
      password: '[Redacted]',
      username: 'alice',
    });
  });
});

/**
 * The keys the logger is configured to redact, read back off the options it
 * produces rather than restated here. A key added to the implementation is
 * therefore covered by the tests above without touching this file — and one
 * that cannot actually be redacted fails them.
 */
function redactedKeys(): string[] {
  return redactPaths().filter((path) => !path.includes('.'));
}

/**
 * How deep the enumerated wildcard paths reach: one level for the bare key,
 * plus one per `*.` prefix on the longest path configured for it.
 */
function configuredNestingDepth(): number {
  const [key] = redactedKeys();

  return redactPaths().filter((path) => path.endsWith(`.${key}`)).length + 1;
}

function redactPaths(): string[] {
  const { redact } = createLoggerModuleParams(
    config('info'),
    new RequestContextService(),
  ).pinoHttp as { redact: { paths: string[] } };

  return redact.paths;
}

/**
 * Wraps `password` in `depth - 1` plain objects, so the secret itself sits at
 * the requested depth counting the logged object as level one.
 */
function nest(depth: number, secret: string): Record<string, unknown> {
  let payload: Record<string, unknown> = { password: secret };

  for (let level = 1; level < depth; level += 1) {
    payload = { nested: payload };
  }

  return { ...payload, context: 'RedactionLogger' };
}

function fieldsOf(record: Record<string, unknown>): string[] {
  return Object.keys(record).sort();
}

/**
 * Every field on an access log for a request that matched a route: the base
 * fields, the correlation fields a request always has, and the four the access
 * log itself adds.
 */
function expectedAccessLogFields(): string[] {
  return [...BASE_FIELDS, ...ACCESS_LOG_FIELDS, 'request_id', 'source'].sort();
}
