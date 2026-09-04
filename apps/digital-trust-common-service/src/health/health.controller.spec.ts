import { Test, TestingModule } from '@nestjs/testing';

import { GracefulShutdownService } from '../shutdown/shutdown.service';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let shutdownService: jest.Mocked<GracefulShutdownService>;

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
});
