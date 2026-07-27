import { PgBossService } from '@app/pg-boss';
import { Test, TestingModule } from '@nestjs/testing';

import { ShutdownRegistry } from '../shutdown/shutdown-registry';

import { JobsService } from './jobs.service';

describe('JobsService', () => {
  let service: JobsService;
  let shutdownRegistry: ShutdownRegistry;

  const send = jest.fn();

  const mockPgBossService = {
    boss: {
      send,
    },
  } as unknown as PgBossService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobsService,
        {
          provide: PgBossService,
          useValue: mockPgBossService,
        },
        ShutdownRegistry,
      ],
    }).compile();

    service = module.get(JobsService);
    shutdownRegistry = module.get(ShutdownRegistry);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should register itself with shutdown registry on module init', () => {
    const registerSpy = jest.spyOn(shutdownRegistry, 'register');

    service.onModuleInit();

    expect(registerSpy).toHaveBeenCalledWith(service);
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

  it('should propagate errors from pg-boss', async () => {
    const error = new Error('send failed');

    send.mockRejectedValue(error);

    await expect(service.publish('test-job', {})).rejects.toThrow(
      'send failed',
    );
  });

  it('should shutdown the boss service', async () => {
    const stop = jest.fn().mockResolvedValue(undefined);
    mockPgBossService.boss.stop = stop;

    await service.shutdown();

    expect(stop).toHaveBeenCalledTimes(1);
  });
});
