import { PgBossService } from '@app/pg-boss';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { configureApp } from '../src/app.config';
import { SwaggerService } from '../src/swagger/swagger.service';

import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  const mockBoss = {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
    // OperationPurgeService.onModuleInit() registers its cron queue/worker on
    // every app bootstrap, so the mock boss must support these too or the
    // whole AppModule fails to initialize (see OperationPurgeService).
    createQueue: jest.fn().mockResolvedValue(undefined),
    schedule: jest.fn().mockResolvedValue(undefined),
    work: jest.fn().mockResolvedValue('worker-1'),
  };

  // Named so the teardown can assert pg-boss was actually stopped.
  const pgBossService = {
    boss: mockBoss,
    initializeBoss: jest.fn().mockResolvedValue(mockBoss),
    stop: jest.fn().mockResolvedValue(undefined),
    isRunning: jest.fn().mockReturnValue(true),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PgBossService)
      .useValue(pgBossService)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    SwaggerService.setupSwagger(app, moduleFixture.get(ConfigService));
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/health/live (GET) stays on a stable, unversioned path (AG-01 D5)', () => {
    return request(app.getHttpServer())
      .get('/health/live')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('api/docs (GET) Swagger UI stays reachable on a stable, unversioned path (AG-01 D5)', () => {
    // swagger-ui-express serves the UI HTML directly at the setup path, so
    // this is a deterministic 200 (not a redirect) — pinned to catch a
    // regression if the global prefix ever starts swallowing the docs mount.
    return request(app.getHttpServer()).get('/api/docs').expect(200);
  });

  it('/admin/operations/stats (GET) 404s without the mandatory /api/v1 version segment (AG-01 D2)', () => {
    // Intent: versioning is explicit (no defaultVersion), so a business route
    // requested without the /api/v1 segment must resolve to NO route -> 404.
    // If this ever returns something else, suspect a newly-added catch-all,
    // legacy redirect, or an accidental `defaultVersion` — do NOT dismiss it
    // as a stale assertion.
    return request(app.getHttpServer())
      .get('/admin/operations/stats')
      .expect(404);
  });

  afterEach(async () => {
    await app.close();

    // Closing the app must actually reach pg-boss. GracefulShutdownService
    // catches and logs whatever a participant throws, so a teardown that fails
    // leaves the suite green — which is how a double missing `stop` went
    // unnoticed here in the first place.
    expect(pgBossService.stop).toHaveBeenCalledTimes(1);
  });
});
