// Overrides the e2e default (`RATE_LIMIT_ENABLED=false`, set by
// jest-e2e-setup.ts) so this file — and only this file — exercises the real
// `TenantRateLimitGuard` end to end. A small standard-tier limit keeps the
// test fast and deterministic. These must be set before `AppModule` (and
// therefore `ConfigModule.forRoot()`) is imported/compiled below.
process.env.RATE_LIMIT_ENABLED = 'true';
process.env.RATE_LIMIT_STANDARD_PER_MINUTE = '2';
process.env.RATE_LIMIT_WINDOW_MS = '60000';

import { PgBossService } from '@app/pg-boss';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';

import { configureApp } from '../src/app.config';
import { AppModule } from '../src/app.module';
import { API_BASE_PATH } from '../src/common/constants/api-version.constants';
import { RateLimitHit } from '../src/rate-limit/rate-limit-hit.entity';

const mockBoss = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  send: jest.fn().mockResolvedValue(undefined),
  createQueue: jest.fn().mockResolvedValue(undefined),
  schedule: jest.fn().mockResolvedValue(undefined),
  work: jest.fn().mockResolvedValue(undefined),
};

// GET /scopes has no `:tenantId` path param (tracker falls back to caller
// IP) and only `@UseGuards(JwtGuard)` — no roles/scopes. `JwtGuard` is left
// un-overridden on purpose: `TenantRateLimitGuard` is a global `APP_GUARD`
// that runs ahead of it, so an unauthenticated caller must still be able to
// prove the guard blocks with 429 before ever reaching JwtGuard's 401.
const ROUTE_KEY = 'ScopeController.listScopes';

describe('TenantRateLimitGuard (e2e)', () => {
  let app: INestApplication<App>;
  let hitRepo: Repository<RateLimitHit>;

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

    hitRepo = moduleFixture.get(getRepositoryToken(RateLimitHit));
  });

  beforeEach(async () => {
    // Guard against leftover hits from a previous local run polluting this
    // IP-keyed bucket before the assertions below.
    await hitRepo.delete({ routeKey: ROUTE_KEY });
  });

  afterAll(async () => {
    await hitRepo.delete({ routeKey: ROUTE_KEY });
    await app.close();
  });

  it('admits requests up to the configured limit, then blocks with a Retry-After header', async () => {
    // isBlocked = totalHits > limit (rate-limit-storage.service.ts), and the
    // limit above is 2: requests 1 and 2 are admitted by the guard (and then
    // rejected by JwtGuard with 401, since no bearer token is sent), and
    // request 3 is the first with totalHits (3) > limit (2).
    await request(app.getHttpServer())
      .get(`${API_BASE_PATH}/scopes`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`${API_BASE_PATH}/scopes`)
      .expect(401);

    const blocked = await request(app.getHttpServer())
      .get(`${API_BASE_PATH}/scopes`)
      .expect(429);

    expect(blocked.headers['retry-after']).toBeDefined();
  });
});
