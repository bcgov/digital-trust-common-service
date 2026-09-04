import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { GracefulShutdownService } from '../shutdown/shutdown.service';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let shutdownService: jest.Mocked<GracefulShutdownService>;
  let healthService: jest.Mocked<Pick<HealthService, 'ready' | 'status'>>;

  beforeEach(async () => {
    const mockShutdownService = {
      isInShutdown: jest.fn(),
    };
    const mockHealthService = {
      ready: jest.fn(),
      status: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: GracefulShutdownService,
          useValue: mockShutdownService,
        },
        {
          provide: HealthService,
          useValue: mockHealthService,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    shutdownService = module.get(GracefulShutdownService);
    healthService = module.get(HealthService);
  });

  describe('GET /health/live', () => {
    it('should return status ok', () => {
      expect(controller.live()).toEqual({ status: 'ok' });
    });

    // Draining a terminating pod is readiness' job. Failing liveness here would
    // ask the kubelet to restart a container that is shutting down on purpose.
    it('should stay live during graceful shutdown', () => {
      shutdownService.isInShutdown.mockReturnValue(true);

      expect(controller.live()).toEqual({ status: 'ok' });
    });
  });
  describe('GET /health/ready', () => {
    it('returns what the health service reports', async () => {
      const result = {
        details: { database: { status: 'up' } },
        error: {},
        info: { database: { status: 'up' } },
        status: 'ok',
      };
      healthService.ready.mockResolvedValue(
        result as unknown as Awaited<ReturnType<HealthService['ready']>>,
      );

      await expect(controller.ready()).resolves.toBe(result);
      expect(healthService.ready).toHaveBeenCalledTimes(1);
    });

    it('propagates the 503 raised when the service is not ready', async () => {
      healthService.ready.mockRejectedValue(new ServiceUnavailableException());

      await expect(controller.ready()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('GET /health/status', () => {
    it('returns what the health service reports', async () => {
      const result = {
        details: {
          database: { status: 'up' as const },
          oidcProvider: { status: 'up' as const },
          pgBoss: { status: 'down' as const },
        },
        status: 'degraded' as const,
      };
      healthService.status.mockResolvedValue(result);

      await expect(controller.status()).resolves.toBe(result);
      expect(healthService.status).toHaveBeenCalledTimes(1);
    });

    it('propagates the 503 raised during graceful shutdown', async () => {
      healthService.status.mockRejectedValue(new ServiceUnavailableException());

      await expect(controller.status()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});
