import { PgBossService } from '@app/pg-boss';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { configureApp } from '../src/app.config';
import { AppModule } from '../src/app.module';
import { API_BASE_PATH } from '../src/common/constants/api-version.constants';

/**
 * Thin auth-enforcement smoke for product controllers now behind JwtGuard.
 * Happy-path business e2e continues to override guards; wrong-scope /
 * wrong-tenant coverage lives in jwt-guard.integration-spec.ts.
 */
describe('product controllers (e2e) — auth enforcement', () => {
  let app: INestApplication<App>;

  const mockBoss = {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
    createQueue: jest.fn().mockResolvedValue(undefined),
    schedule: jest.fn().mockResolvedValue(undefined),
    work: jest.fn().mockResolvedValue(undefined),
  };

  const tenantId = '123e4567-e89b-12d3-a456-426614174001';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PgBossService)
      .useValue({
        boss: mockBoss,
        initializeBoss: jest.fn().mockResolvedValue(mockBoss),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it.each([
    ['GET', `${API_BASE_PATH}/tenants/${tenantId}/audit-logs`],
    ['GET', `${API_BASE_PATH}/connections/tenant/${tenantId}`],
    ['GET', `${API_BASE_PATH}/tenants/${tenantId}/clients`],
    ['GET', `${API_BASE_PATH}/connector-credentials/tenant/${tenantId}`],
    ['GET', `${API_BASE_PATH}/credential-definitions/tenant/${tenantId}`],
  ])('%s %s returns 401 without a bearer token', async (method, path) => {
    const response = await request(app.getHttpServer())
      [method.toLowerCase() as 'get'](path)
      .expect(401);

    expect(response.headers['www-authenticate']).toMatch(/Bearer error="/);
    expect(response.body).toMatchObject({
      error: { code: 'AUTHENTICATION_REQUIRED' },
    });
  });
});
