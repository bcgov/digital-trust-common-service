import { Test, TestingModule } from '@nestjs/testing';

import { ShutdownRegistry, ShutdownParticipant } from './shutdown-registry';
import { GracefulShutdownService } from './shutdown.service';

describe('GracefulShutdownService', () => {
  let service: GracefulShutdownService;
  let registry: ShutdownRegistry;

  const mockParticipant1: ShutdownParticipant = {
    order: 1,
    name: 'Participant1',
    shutdown: jest.fn().mockResolvedValue(undefined),
  };

  const mockParticipant2: ShutdownParticipant = {
    order: 2,
    name: 'Participant2',
    shutdown: jest.fn().mockResolvedValue(undefined),
  };

  const mockParticipant3: ShutdownParticipant = {
    order: 0,
    name: 'Participant3',
    shutdown: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [GracefulShutdownService, ShutdownRegistry],
    }).compile();

    service = module.get<GracefulShutdownService>(GracefulShutdownService);
    registry = module.get<ShutdownRegistry>(ShutdownRegistry);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('beforeApplicationShutdown', () => {
    it('should call shutdown on all registered participants', async () => {
      registry.register(mockParticipant1);
      registry.register(mockParticipant2);

      await service.beforeApplicationShutdown();

      expect(mockParticipant1.shutdown).toHaveBeenCalledTimes(1);
      expect(mockParticipant2.shutdown).toHaveBeenCalledTimes(1);
    });

    it('should call participants in order of their order property', async () => {
      const callOrder: string[] = [];

      const trackedParticipant1: ShutdownParticipant = {
        ...mockParticipant1,
        shutdown: jest.fn(() => {
          callOrder.push('Participant1');
          return Promise.resolve();
        }),
      };

      const trackedParticipant2: ShutdownParticipant = {
        ...mockParticipant2,
        shutdown: jest.fn(() => {
          callOrder.push('Participant2');
          return Promise.resolve();
        }),
      };

      const trackedParticipant3: ShutdownParticipant = {
        ...mockParticipant3,
        shutdown: jest.fn(() => {
          callOrder.push('Participant3');
          return Promise.resolve();
        }),
      };

      registry.register(trackedParticipant1);
      registry.register(trackedParticipant2);
      registry.register(trackedParticipant3);

      await service.beforeApplicationShutdown();

      expect(callOrder).toEqual([
        'Participant2',
        'Participant1',
        'Participant3',
      ]);
    });

    it('should pass the signal to all participants', async () => {
      registry.register(mockParticipant1);
      registry.register(mockParticipant2);

      const signal = 'SIGTERM';
      await service.beforeApplicationShutdown(signal);

      expect(mockParticipant1.shutdown).toHaveBeenCalledWith(signal);
      expect(mockParticipant2.shutdown).toHaveBeenCalledWith(signal);
    });

    it('should handle errors from participants gracefully', async () => {
      const errorParticipant: ShutdownParticipant = {
        order: 1,
        name: 'FailingParticipant',
        shutdown: jest.fn().mockRejectedValue(new Error('Shutdown failed')),
      };

      registry.register(errorParticipant);
      registry.register(mockParticipant1);

      await expect(service.beforeApplicationShutdown()).resolves.not.toThrow();

      expect(errorParticipant.shutdown).toHaveBeenCalledTimes(1);
      expect(mockParticipant1.shutdown).toHaveBeenCalledTimes(1);
    });

    it('should continue shutting down other participants even if one fails', async () => {
      const failingParticipant: ShutdownParticipant = {
        order: 1,
        name: 'FailingParticipant',
        shutdown: jest.fn().mockRejectedValue(new Error('Shutdown failed')),
      };

      const successParticipant: ShutdownParticipant = {
        order: 2,
        name: 'SuccessParticipant',
        shutdown: jest.fn().mockResolvedValue(undefined),
      };

      registry.register(failingParticipant);
      registry.register(successParticipant);

      await service.beforeApplicationShutdown();

      expect(failingParticipant.shutdown).toHaveBeenCalledTimes(1);
      expect(successParticipant.shutdown).toHaveBeenCalledTimes(1);
    });

    it('should handle non-Error exceptions gracefully', async () => {
      const nonErrorParticipant: ShutdownParticipant = {
        order: 1,
        name: 'NonErrorParticipant',
        shutdown: jest.fn().mockRejectedValue('Some string error'),
      };

      registry.register(nonErrorParticipant);
      registry.register(mockParticipant1);

      await expect(service.beforeApplicationShutdown()).resolves.not.toThrow();

      expect(nonErrorParticipant.shutdown).toHaveBeenCalledTimes(1);
      expect(mockParticipant1.shutdown).toHaveBeenCalledTimes(1);
    });

    it('should handle empty participant list', async () => {
      await expect(service.beforeApplicationShutdown()).resolves.not.toThrow();
    });
  });

  describe('isInShutdown', () => {
    it('should return false initially', () => {
      expect(service.isInShutdown()).toBe(false);
    });

    it('should return true during shutdown', async () => {
      const slowParticipant: ShutdownParticipant = {
        order: 1,
        name: 'SlowParticipant',
        shutdown: jest.fn(async () => {
          // Check that isInShutdown is true while shutting down

          // Wait a moment to simulate a slow shutdown
          await new Promise((resolve) => setTimeout(resolve, 1));
          expect(service.isInShutdown()).toBe(true);
        }),
      };

      registry.register(slowParticipant);

      await service.beforeApplicationShutdown();

      expect(service.isInShutdown()).toBe(false);
    });
  });
});
