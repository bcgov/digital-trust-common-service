import { OidcKeysService, OidcProviderService } from '@app/oidc';
import { PgBossService } from '@app/pg-boss';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';

import { GracefulShutdownService } from '../shutdown/shutdown.service';

import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  let health: jest.Mocked<Pick<HealthCheckService, 'check'>>;
  let database: jest.Mocked<Pick<TypeOrmHealthIndicator, 'pingCheck'>>;
  let shutdownService: jest.Mocked<
    Pick<GracefulShutdownService, 'isInShutdown'>
  >;
  let pgBossService: jest.Mocked<Pick<PgBossService, 'isRunning'>>;
  let oidcProviderService: jest.Mocked<
    Pick<OidcProviderService, 'getProvider'>
  >;
  let oidcKeysService: jest.Mocked<Pick<OidcKeysService, 'getJwks'>>;

  beforeEach(() => {
    health = {
      check: jest.fn(),
    };
    database = {
      pingCheck: jest.fn(),
    };
    shutdownService = {
      isInShutdown: jest.fn().mockReturnValue(false),
    };
    pgBossService = {
      isRunning: jest.fn().mockReturnValue(true),
    };
    oidcProviderService = {
      getProvider: jest.fn().mockReturnValue({}),
    };
    oidcKeysService = {
      getJwks: jest.fn().mockReturnValue({ keys: [{}] }),
    };

    service = new HealthService(
      health as HealthCheckService,
      database as TypeOrmHealthIndicator,
      shutdownService as GracefulShutdownService,
      pgBossService as PgBossService,
      oidcProviderService as OidcProviderService,
      oidcKeysService as OidcKeysService,
    );
  });

  describe('ready', () => {
    it('returns the database readiness result', async () => {
      const result = {
        status: 'ok',
        info: { database: { status: 'up' } },
        error: {},
        details: { database: { status: 'up' } },
      };

      health.check.mockImplementation(async (checks) => {
        await checks[0]();
        return result;
      });
      database.pingCheck.mockResolvedValue({ database: { status: 'up' } });

      await expect(service.ready()).resolves.toBe(result);

      expect(database.pingCheck).toHaveBeenCalledWith('database', {
        timeout: 1000,
      });
      expect(pgBossService.isRunning).not.toHaveBeenCalled();
      expect(oidcProviderService.getProvider).not.toHaveBeenCalled();
    });

    it('reports shutdown before checking the database', async () => {
      shutdownService.isInShutdown.mockReturnValue(true);

      await expect(service.ready()).rejects.toThrow(
        ServiceUnavailableException,
      );

      expect(health.check).not.toHaveBeenCalled();
      expect(database.pingCheck).not.toHaveBeenCalled();
    });
  });

  describe('status', () => {
    beforeEach(() => {
      database.pingCheck.mockResolvedValue({ database: { status: 'up' } });
    });

    it('reports all dependencies up', async () => {
      await expect(service.status()).resolves.toEqual({
        status: 'ok',
        details: {
          database: { status: 'up' },
          oidcProvider: { status: 'up' },
          pgBoss: { status: 'up' },
        },
      });
    });

    it('reports pg-boss down without failing the endpoint', async () => {
      pgBossService.isRunning.mockReturnValue(false);

      await expect(service.status()).resolves.toEqual({
        status: 'degraded',
        details: {
          database: { status: 'up' },
          oidcProvider: { status: 'up' },
          pgBoss: { status: 'down' },
        },
      });
    });

    it('reports the OIDC provider down when it is unavailable', async () => {
      oidcProviderService.getProvider.mockImplementation(() => {
        throw new Error('unavailable');
      });

      await expect(service.status()).resolves.toMatchObject({
        status: 'degraded',
        details: {
          oidcProvider: { status: 'down' },
        },
      });
    });

    it('reports the database down when the ping reports it down', async () => {
      // How terminus actually signals failure: it resolves with a down result
      // rather than throwing.
      database.pingCheck.mockResolvedValue({ database: { status: 'down' } });

      await expect(service.status()).resolves.toMatchObject({
        status: 'degraded',
        details: {
          database: { status: 'down' },
        },
      });
    });

    it('reports the database down when the check throws unexpectedly', async () => {
      database.pingCheck.mockRejectedValue(new Error('unavailable'));

      await expect(service.status()).resolves.toMatchObject({
        status: 'degraded',
        details: {
          database: { status: 'down' },
        },
      });
    });

    it('reports shutdown before checking dependencies', async () => {
      shutdownService.isInShutdown.mockReturnValue(true);

      await expect(service.status()).rejects.toThrow(
        ServiceUnavailableException,
      );

      expect(database.pingCheck).not.toHaveBeenCalled();
      expect(pgBossService.isRunning).not.toHaveBeenCalled();
      expect(oidcProviderService.getProvider).not.toHaveBeenCalled();
    });
  });
});
