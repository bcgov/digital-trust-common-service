import { HttpException, HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { GracefulShutdownService } from '../shutdown/shutdown.service';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let shutdownService: jest.Mocked<GracefulShutdownService>;

  beforeEach(async () => {
    const mockShutdownService = {
      isInShutdown: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: GracefulShutdownService,
          useValue: mockShutdownService,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    shutdownService = module.get(GracefulShutdownService);
  });

  describe('GET /health/live', () => {
    it('should return status ok when not in shutdown', () => {
      shutdownService.isInShutdown.mockReturnValue(false);
      expect(controller.live()).toEqual({ status: 'ok' });
    });

    it('should throw SERVICE_UNAVAILABLE when in shutdown', () => {
      shutdownService.isInShutdown.mockReturnValue(true);
      expect(() => controller.live()).toThrow(
        new HttpException(
          'Shutdown in progress',
          HttpStatus.SERVICE_UNAVAILABLE,
        ),
      );
    });
  });
});
