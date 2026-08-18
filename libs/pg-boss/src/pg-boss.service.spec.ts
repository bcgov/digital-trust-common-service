import { ConfigService } from '@nestjs/config';

import { PgBossService } from './pg-boss.service';

describe('PgBossService', () => {
  let service: PgBossService;

  const config = {
    get: jest.fn(),
    getOrThrow: jest.fn(),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    service = new PgBossService(config);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts pg-boss on module init', async () => {
    const start = jest.fn().mockResolvedValue(undefined);
    const mockBoss = { start, stop: jest.fn() };

    jest.spyOn(service as any, 'createBoss').mockResolvedValue(mockBoss);

    await service.initializeBoss();

    expect(start).toHaveBeenCalledTimes(1);
    expect(service.boss).toBe(mockBoss);
  });

  describe('startWithRetry', () => {
    it('should succeed on first attempt', async () => {
      const start = jest.fn().mockResolvedValue(undefined);
      const mockBoss = { start, stop: jest.fn() };

      jest.spyOn(service as any, 'createBoss').mockResolvedValue(mockBoss);

      await service.initializeBoss();

      expect(start).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed on second attempt', async () => {
      const start = jest
        .fn()
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockResolvedValueOnce(undefined);

      const mockBoss = { start, stop: jest.fn() };

      jest.spyOn(service as any, 'createBoss').mockResolvedValue(mockBoss);

      const initPromise = service.initializeBoss();
      await jest.runAllTimersAsync();

      await initPromise;

      expect(start).toHaveBeenCalledTimes(2);
    });

    it('should retry multiple times', async () => {
      const start = jest
        .fn()
        .mockRejectedValueOnce(new Error('Attempt 1 failed'))
        .mockRejectedValueOnce(new Error('Attempt 2 failed'))
        .mockResolvedValueOnce(undefined);

      const mockBoss = { start, stop: jest.fn() };

      jest.spyOn(service as any, 'createBoss').mockResolvedValue(mockBoss);

      const initPromise = service.initializeBoss();
      await jest.runAllTimersAsync();

      await initPromise;

      expect(start).toHaveBeenCalledTimes(3);
    });

    it('should use exponential backoff delays between retries', async () => {
      const delaySpies: number[] = [];

      const mockDelay: (ms: number) => Promise<void> = (ms: number) => {
        delaySpies.push(ms);
        return Promise.resolve();
      };

      (jest.spyOn(service as any, 'delay') as any).mockImplementation(
        mockDelay,
      );

      const start = jest
        .fn()
        .mockRejectedValueOnce(new Error('Attempt 1 failed'))
        .mockRejectedValueOnce(new Error('Attempt 2 failed'))
        .mockResolvedValueOnce(undefined);

      const mockBoss = { start, stop: jest.fn() };

      jest.spyOn(service as any, 'createBoss').mockResolvedValue(mockBoss);

      const initPromise = service.initializeBoss();
      await jest.runAllTimersAsync();

      await initPromise;

      // Expected delays: 1s, 2s for 2 retries (1st and 2nd)
      expect(delaySpies).toEqual([1000, 2000]);
    });
  });

  describe('createBoss pool sizing', () => {
    /**
     * pg-boss opens a pg.Pool of its own instead of sharing TypeORM's, so its
     * ceiling adds to a pod's connection count. These assert the bound is
     * actually passed through — unbounded, pg-boss silently defaults to 10.
     */
    const buildOptions = (env: Record<string, string> = {}) => {
      (config.get as jest.Mock).mockImplementation(
        (key: string, fallback?: string) => env[key] ?? fallback,
      );
      (config.getOrThrow as jest.Mock).mockImplementation(
        (key: string) => env[key] ?? 'test-value',
      );

      return service.buildBossOptions();
    };

    it('defaults the pg-boss pool to PGBOSS_POOL_MAX of 5', () => {
      expect(buildOptions()?.max).toBe(5);
    });

    it('honours a PGBOSS_POOL_MAX override', () => {
      expect(buildOptions({ PGBOSS_POOL_MAX: '3' })?.max).toBe(3);
    });

    it('rejects a non-numeric PGBOSS_POOL_MAX', () => {
      expect(() => buildOptions({ PGBOSS_POOL_MAX: '5x' })).toThrow(
        /PGBOSS_POOL_MAX/,
      );
    });

    it('rejects a zero PGBOSS_POOL_MAX', () => {
      expect(() => buildOptions({ PGBOSS_POOL_MAX: '0' })).toThrow(
        /PGBOSS_POOL_MAX/,
      );
    });
  });
});
