import { LogAccessRateLimiter } from './log-access-rate-limiter';
import { LogAccessTokenService } from './log-access-token.service';
import {
  LOG_ACCESS_RATE_LIMIT_MAX_REQUESTS,
  LOG_ACCESS_RATE_LIMIT_MAX_TENANTS,
  LOG_ACCESS_RATE_LIMIT_WINDOW_MS,
} from './log-access.constants';
import { LogAccessService } from './log-access.service';

const TENANT_A = '3f2b8c1e-5d4a-4e7b-9a10-0c6d2f8e7b11';
const TENANT_B = '9a1c2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e';

describe('LogAccessRateLimiter', () => {
  let limiter: LogAccessRateLimiter;

  beforeEach(() => {
    jest.useFakeTimers();
    limiter = new LogAccessRateLimiter();
  });

  afterEach(() => jest.useRealTimers());

  const exhaust = (tenantId: string): void => {
    for (let i = 0; i < LOG_ACCESS_RATE_LIMIT_MAX_REQUESTS; i += 1) {
      expect(limiter.tryConsume(tenantId)).toBe(true);
    }
  };

  it('allows up to the budget then refuses', () => {
    exhaust(TENANT_A);
    expect(limiter.tryConsume(TENANT_A)).toBe(false);
  });

  it('keeps tenants independent and recovers after the window', () => {
    exhaust(TENANT_A);

    expect(limiter.tryConsume(TENANT_B)).toBe(true);
    expect(limiter.tryConsume(TENANT_A)).toBe(false);

    jest.advanceTimersByTime(LOG_ACCESS_RATE_LIMIT_WINDOW_MS);
    expect(limiter.tryConsume(TENANT_A)).toBe(true);
  });

  it('evicts the oldest bucket when full', () => {
    exhaust(TENANT_A);
    for (let i = 0; i < LOG_ACCESS_RATE_LIMIT_MAX_TENANTS - 1; i += 1) {
      limiter.tryConsume(`tenant-${i}`);
    }
    expect(limiter.tryConsume(TENANT_A)).toBe(false);

    limiter.tryConsume('one-more');

    // TENANT_A was oldest, so its exhausted bucket was dropped.
    expect(limiter.tryConsume(TENANT_A)).toBe(true);
  });

  it('drops expired buckets before evicting live ones', () => {
    for (let i = 0; i < LOG_ACCESS_RATE_LIMIT_MAX_TENANTS; i += 1) {
      limiter.tryConsume(`tenant-${i}`);
    }
    jest.advanceTimersByTime(LOG_ACCESS_RATE_LIMIT_WINDOW_MS / 2);
    exhaust(TENANT_B);
    jest.advanceTimersByTime(LOG_ACCESS_RATE_LIMIT_WINDOW_MS / 2);

    limiter.tryConsume('fresh');

    expect(limiter.tryConsume(TENANT_B)).toBe(false);
  });
});

describe('LogAccessService rate limiting', () => {
  it('denies 429 before resolving agent partitions', async () => {
    const resolve = jest.fn().mockResolvedValue([]);
    const service = new LogAccessService(
      {
        authorize: jest.fn().mockResolvedValue({ tenantId: TENANT_A }),
      } as unknown as LogAccessTokenService,
      { resolveAgentPartitions: resolve },
      { tryConsume: jest.fn().mockReturnValue(false) } as never,
    );

    await expect(service.resolveScope('Bearer x')).rejects.toMatchObject({
      status: 429,
      reason: 'rate_limited',
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('serves requests within the budget', async () => {
    const service = new LogAccessService(
      {
        authorize: jest.fn().mockResolvedValue({ tenantId: TENANT_A }),
      } as unknown as LogAccessTokenService,
      { resolveAgentPartitions: jest.fn().mockResolvedValue([]) },
      new LogAccessRateLimiter(),
    );

    await expect(service.resolveScope('Bearer x')).resolves.toBe(
      `t-${TENANT_A}`,
    );
  });
});
