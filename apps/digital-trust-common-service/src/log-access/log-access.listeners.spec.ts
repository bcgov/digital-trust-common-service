import { createServer as createHttpServer, type Server } from 'http';
import type { AddressInfo } from 'net';

import { RequestContextService } from '@app/common/context/request-context.service';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApp } from '../app.config';

import { InternalListener } from './internal-listener';
import { LogAccessController } from './log-access.controller';
import { LogAccessService } from './log-access.service';

// TLS is not what is under test here, so the listener's https server is
// replaced by a plain one that keeps the same request callback.
let internalServer: Server;

jest.mock('https', () => ({
  createServer: (
    _options: unknown,
    handler: Parameters<typeof createHttpServer>[1],
  ): Server => {
    internalServer = createHttpServer(handler);
    return internalServer;
  },
}));
jest.mock('fs', () => ({
  ...jest.requireActual<typeof import('fs')>('fs'),
  readFileSync: jest.fn(() => 'pem'),
}));

@Controller('tenants')
class PublicApiController {
  @Get()
  public list(): string[] {
    return [];
  }
}

describe('log access listeners with the production app configuration', () => {
  const resolveScope = jest.fn();
  let app: INestApplication;
  let internal: string;

  beforeAll(async () => {
    const values: Record<string, string> = {
      LOG_ACCESS_INTERNAL_PORT: '0',
      LOG_ACCESS_INTERNAL_TLS_CERT_PATH: '/tls/tls.crt',
      LOG_ACCESS_INTERNAL_TLS_KEY_PATH: '/tls/tls.key',
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [LogAccessController, PublicApiController],
      providers: [
        InternalListener,
        RequestContextService,
        { provide: LogAccessService, useValue: { resolveScope } },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback?: string) => values[key] ?? fallback,
            getOrThrow: (key: string) => values[key],
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    await app.get(InternalListener).start(app);

    internal = `http://127.0.0.1:${(internalServer.address() as AddressInfo).port}`;
  });

  afterAll(() => app.close());

  beforeEach(() => resolveScope.mockReset());

  it('allows the prefixed check internally with the computed scope header', async () => {
    resolveScope.mockResolvedValue('t-abc');

    const res = await request(internal)
      .get('/internal/log-access/check/loki/api/v1/query_range')
      .set('Authorization', 'Bearer t')
      .expect(200);

    expect(res.headers['x-scope-orgid']).toBe('t-abc');
    expect(res.text).toBe('');
    expect(resolveScope).toHaveBeenCalledWith('Bearer t');
  });

  it.each([
    '/internal/log-access/check',
    '/internal/log-access/check/loki/api/v1/query_range',
    '/INTERNAL/Log-Access/check',
  ])('answers 404 for %s on the public listener', async (path) => {
    await request(app.getHttpServer() as Server)
      .get(path)
      .expect(404);
    expect(resolveScope).not.toHaveBeenCalled();
  });

  it.each(['/api/v1/tenants', '/tenants', '/oidc/token', '/health/ready'])(
    'refuses %s on the internal listener',
    async (path) => {
      await request(internal).get(path).expect(404);
    },
  );
});
