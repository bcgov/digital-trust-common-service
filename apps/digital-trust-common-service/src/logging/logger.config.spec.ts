import { Writable } from 'node:stream';

import { ConsoleLogger, Logger as NestLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { LoggerModule, Logger as PinoNestLogger } from 'nestjs-pino';
import { type Logger as PinoLogger } from 'pino';

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
      createLoggerModuleParams(config('nonsense'), stream),
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
        LoggerModule.forRoot(createLoggerModuleParams(config('info'), stream)),
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
});

function createLogger(logLevel: string | undefined): {
  logger: PinoLogger;
  stream: InMemoryStream;
} {
  const stream = new InMemoryStream();
  const params = createLoggerModuleParams(config(logLevel), stream);
  const pinoHttp = params.pinoHttp as { logger: PinoLogger };

  return { logger: pinoHttp.logger, stream };
}

function config(logLevel: string | undefined): ConfigService {
  return {
    get: (key: string) => (key === 'LOG_LEVEL' ? logLevel : undefined),
  } as ConfigService;
}
