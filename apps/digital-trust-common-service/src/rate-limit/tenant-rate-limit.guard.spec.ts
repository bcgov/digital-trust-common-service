import { ExecutionContext } from '@nestjs/common';

import { TenantRateLimitGuard } from './tenant-rate-limit.guard';

describe('TenantRateLimitGuard', () => {
  let guard: TenantRateLimitGuard;

  beforeEach(() => {
    // Bypasses the real constructor (which needs ThrottlerModuleOptions,
    // storage, and a Reflector) since the methods under test don't touch
    // any instance state set up there.
    guard = Object.create(
      TenantRateLimitGuard.prototype,
    ) as TenantRateLimitGuard;
  });

  describe('getTracker', () => {
    it('uses the tenantId route param when present', async () => {
      const tracker = await (
        guard as unknown as {
          getTracker(req: Record<string, unknown>): Promise<string>;
        }
      ).getTracker({ params: { tenantId: 't1' }, ip: '203.0.113.5' });

      expect(tracker).toBe('t1');
    });

    it('falls back to the caller IP when there is no tenantId param', async () => {
      const tracker = await (
        guard as unknown as {
          getTracker(req: Record<string, unknown>): Promise<string>;
        }
      ).getTracker({ params: {}, ip: '203.0.113.5' });

      expect(tracker).toBe('203.0.113.5');
    });

    it('falls back to the caller IP when there are no route params at all', async () => {
      const tracker = await (
        guard as unknown as {
          getTracker(req: Record<string, unknown>): Promise<string>;
        }
      ).getTracker({ ip: '203.0.113.5' });

      expect(tracker).toBe('203.0.113.5');
    });
  });

  describe('generateKey', () => {
    it('builds a composite key from the tracker and the class/handler name', () => {
      const context = {
        getClass: () => ({ name: 'ConnectorCredentialController' }),
        getHandler: () => ({ name: 'create' }),
      } as unknown as ExecutionContext;

      const key = (
        guard as unknown as {
          generateKey(
            context: ExecutionContext,
            tracker: string,
            throttlerName: string,
          ): string;
        }
      ).generateKey(context, 't1', 'default');

      expect(key).toBe('t1::ConnectorCredentialController.create');
    });
  });

  describe('shouldSkip', () => {
    // Intersecting with `TenantRateLimitGuard` directly would collide with
    // its private `config` field (reducing the type to `never`), so this
    // narrow interface is declared standalone, same as the getTracker /
    // generateKey casts above.
    type GuardWithConfig = {
      config: { get: jest.Mock };
      shouldSkip(context: ExecutionContext): Promise<boolean>;
    };

    function withConfig(value: string | undefined): GuardWithConfig {
      const instance = Object.create(
        TenantRateLimitGuard.prototype,
      ) as GuardWithConfig;
      instance.config = { get: jest.fn().mockReturnValue(value ?? 'true') };
      return instance;
    }

    it('does not skip when RATE_LIMIT_ENABLED is unset (defaults to enabled)', async () => {
      await expect(
        withConfig(undefined).shouldSkip({} as ExecutionContext),
      ).resolves.toBe(false);
    });

    it('skips when RATE_LIMIT_ENABLED=false', async () => {
      await expect(
        withConfig('false').shouldSkip({} as ExecutionContext),
      ).resolves.toBe(true);
    });
  });
});
