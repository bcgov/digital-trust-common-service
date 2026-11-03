import { RateLimitHitRepository } from '../rate-limit/rate-limit-hit.repository';
import { RateLimitStorageService } from '../rate-limit/rate-limit-storage.service';

import { LogAccessRateLimiter } from './log-access-rate-limiter';
import {
  LOG_ACCESS_RATE_LIMIT_MAX_REQUESTS,
  LOG_ACCESS_RATE_LIMIT_ROUTE_KEY,
  LOG_ACCESS_RATE_LIMIT_WINDOW_MS,
} from './log-access.constants';

const TENANT_A = '3f2b8c1e-5d4a-4e7b-9a10-0c6d2f8e7b11';
const TENANT_B = '9a1c2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e';

class FakeHitRepository {
  private readonly hits: { tracker: string; routeKey: string; at: number }[] =
    [];

  public countSince(
    tracker: string,
    routeKey: string,
    since: Date,
  ): Promise<number> {
    return Promise.resolve(
      this.hits.filter(
        (hit) =>
          hit.tracker === tracker &&
          hit.routeKey === routeKey &&
          hit.at >= since.getTime(),
      ).length,
    );
  }

  public recordHit(tracker: string, routeKey: string): Promise<void> {
    this.hits.push({ tracker, routeKey, at: Date.now() });
    return Promise.resolve();
  }
}

describe('LogAccessRateLimiter', () => {
  let repository: FakeHitRepository;
  let storage: RateLimitStorageService;
  let limiter: LogAccessRateLimiter;

  beforeEach(() => {
    jest.useFakeTimers();
    repository = new FakeHitRepository();
    storage = new RateLimitStorageService(
      repository as unknown as RateLimitHitRepository,
    );
    limiter = new LogAccessRateLimiter(storage);
  });

  afterEach(() => jest.useRealTimers());

  const exhaust = async (
    target: LogAccessRateLimiter,
    tenantId: string,
  ): Promise<void> => {
    for (let i = 0; i < LOG_ACCESS_RATE_LIMIT_MAX_REQUESTS; i += 1) {
      await expect(target.tryConsume(tenantId)).resolves.toBe(true);
    }
  };

  it('allows the budget and blocks the next request', async () => {
    await exhaust(limiter, TENANT_A);

    await expect(limiter.tryConsume(TENANT_A)).resolves.toBe(false);
  });

  it('shares one budget across replicas using the same storage', async () => {
    const otherReplica = new LogAccessRateLimiter(storage);

    for (let i = 0; i < LOG_ACCESS_RATE_LIMIT_MAX_REQUESTS; i += 1) {
      await (i % 2 === 0 ? limiter : otherReplica).tryConsume(TENANT_A);
    }

    await expect(limiter.tryConsume(TENANT_A)).resolves.toBe(false);
    await expect(otherReplica.tryConsume(TENANT_A)).resolves.toBe(false);
  });

  it('keeps tenants independent', async () => {
    await exhaust(limiter, TENANT_A);

    await expect(limiter.tryConsume(TENANT_B)).resolves.toBe(true);
    await expect(limiter.tryConsume(TENANT_A)).resolves.toBe(false);
  });

  it('does not share a budget with other route keys', async () => {
    for (let i = 0; i < LOG_ACCESS_RATE_LIMIT_MAX_REQUESTS + 5; i += 1) {
      await repository.recordHit(TENANT_A, 'global');
    }

    await expect(limiter.tryConsume(TENANT_A)).resolves.toBe(true);

    await exhaust(limiter, TENANT_B);
    await expect(
      repository.countSince(TENANT_B, 'global', new Date(0)),
    ).resolves.toBe(0);
    await expect(
      repository.countSince(
        TENANT_B,
        LOG_ACCESS_RATE_LIMIT_ROUTE_KEY,
        new Date(0),
      ),
    ).resolves.toBe(LOG_ACCESS_RATE_LIMIT_MAX_REQUESTS);
  });

  it('recovers once hits age past the window', async () => {
    await exhaust(limiter, TENANT_A);
    await expect(limiter.tryConsume(TENANT_A)).resolves.toBe(false);

    jest.advanceTimersByTime(LOG_ACCESS_RATE_LIMIT_WINDOW_MS + 1);

    await expect(limiter.tryConsume(TENANT_A)).resolves.toBe(true);
  });
});
