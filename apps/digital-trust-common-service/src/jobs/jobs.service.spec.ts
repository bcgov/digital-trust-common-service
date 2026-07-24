import { PgBossService } from '@app/pg-boss';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';

import { ShutdownRegistry } from '../shutdown/shutdown-registry';

import { JobsService } from './jobs.service';

describe('JobsService', () => {
  let service: JobsService;
  let shutdownRegistry: ShutdownRegistry;

  const send = jest.fn();
  const createQueue = jest.fn().mockResolvedValue(undefined);
  const work = jest.fn().mockResolvedValue('worker-1');
  const stop = jest.fn().mockResolvedValue(undefined);
  const emit = jest.fn();

  const mockPgBossService = {
    boss: {
      send,
      createQueue,
      work,
      stop,
    },
  } as unknown as PgBossService;

  beforeEach(async () => {
    jest.clearAllMocks();
    createQueue.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobsService,
        {
          provide: PgBossService,
          useValue: mockPgBossService,
        },
        ShutdownRegistry,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: string) => {
              if (key === 'NODE_ENV') {
                return 'development';
              }
              return fallback;
            }),
          },
        },
        {
          provide: EventEmitter2,
          useValue: { emit },
        },
      ],
    }).compile();

    service = module.get(JobsService);
    shutdownRegistry = module.get(ShutdownRegistry);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should register itself and ensure queues on module init', async () => {
    const registerSpy = jest.spyOn(shutdownRegistry, 'register');

    await service.onModuleInit();

    expect(registerSpy).toHaveBeenCalledWith(service);
    expect(createQueue).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('jobs.queues.ready');
  });

  it('should publish a job', async () => {
    const jobId = 'job-123';
    const payload = { foo: 'bar' };

    send.mockResolvedValue(jobId);

    await expect(service.publish('test-job', payload)).resolves.toBe(jobId);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('test-job', payload);
  });

  it('should publish a job with null payload', async () => {
    send.mockResolvedValue('job-456');

    await service.publish('test-job', null);

    expect(send).toHaveBeenCalledWith('test-job', null);
  });

  it('should send within a transaction using a TypeORM adapter', async () => {
    send.mockResolvedValue('job-tx');
    const manager = { query: jest.fn() } as any;

    await service.sendInTransaction(manager, 'audit.write', { a: 1 });

    expect(send).toHaveBeenCalledWith(
      'audit.write',
      { a: 1 },
      expect.objectContaining({
        db: expect.objectContaining({
          executeSql: expect.any(Function),
        }),
      }),
    );
  });

  it('should register a worker for a queue', async () => {
    await service.registerWorker('audit.write', async () => undefined);

    expect(work).toHaveBeenCalledWith(
      'audit.write',
      expect.objectContaining({
        pollingIntervalSeconds: 2,
        localConcurrency: 2,
      }),
      expect.any(Function),
    );
  });

  it('should skip worker registration when disabled', async () => {
    await expect(
      service.registerWorker('audit.write', async () => undefined, {
        enabled: false,
      }),
    ).resolves.toBeNull();
    expect(work).not.toHaveBeenCalled();
  });

  it('should propagate errors from pg-boss', async () => {
    const error = new Error('send failed');

    send.mockRejectedValue(error);

    await expect(service.publish('test-job', {})).rejects.toThrow(
      'send failed',
    );
  });

  it('should shutdown the boss service', async () => {
    await service.shutdown();

    expect(stop).toHaveBeenCalledTimes(1);
  });
});
