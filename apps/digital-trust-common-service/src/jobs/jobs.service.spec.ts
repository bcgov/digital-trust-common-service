import type { RequestContextStore } from '@app/common/context/request-context.interface';
import { RequestContextService } from '@app/common/context/request-context.service';
import { PgBossService } from '@app/pg-boss';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { propagation, trace } from '@opentelemetry/api';
import type { Tracer } from '@opentelemetry/api';

import { ShutdownRegistry } from '../shutdown/shutdown-registry';

import { JobsService } from './jobs.service';

describe('JobsService', () => {
  let service: JobsService;
  let shutdownRegistry: ShutdownRegistry;

  const send = jest.fn();
  const createQueue = jest.fn().mockResolvedValue(undefined);
  const work = jest.fn().mockResolvedValue('worker-1');
  const stop = jest.fn().mockResolvedValue(undefined);
  const schedule = jest.fn().mockResolvedValue(undefined);
  const stopService = jest.fn().mockResolvedValue(undefined);
  const emit = jest.fn();
  const getRequestContext = jest.fn().mockReturnValue(undefined);
  const runRequestContext = jest.fn(
    <T>(_store: RequestContextStore, callback: () => T): T => callback(),
  );

  const mockPgBossService = {
    stop: stopService,
    boss: {
      send,
      createQueue,
      work,
      stop,
      schedule,
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
        {
          provide: RequestContextService,
          useValue: {
            get: getRequestContext,
            run: runRequestContext,
          },
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

  it('should merge request-id and tenant-id into published job data when a request context is active', async () => {
    getRequestContext.mockReturnValueOnce({
      requestId: 'req-1',
      tenantId: 'tenant-1',
    });
    send.mockResolvedValue('job-789');

    await service.publish('test-job', { foo: 'bar' });

    expect(send).toHaveBeenCalledWith('test-job', {
      foo: 'bar',
      requestId: 'req-1',
      tenantId: 'tenant-1',
    });
  });

  it('should merge only the request id when no tenant id is on the context', async () => {
    getRequestContext.mockReturnValueOnce({ requestId: 'req-1' });
    send.mockResolvedValue('job-789');

    await service.publish('test-job', null);

    expect(send).toHaveBeenCalledWith('test-job', { requestId: 'req-1' });
  });

  it('should not overwrite a domain tenantId already present on the job data', async () => {
    // e.g. AuditWriteJobData/TenantStatusChangeJobData carry a tenantId
    // that identifies the tenant the job is *about*, which is not
    // necessarily the same tenant as the request's correlation context
    // (a platform-admin action, for instance).
    getRequestContext.mockReturnValueOnce({
      requestId: 'req-1',
      tenantId: 'context-tenant',
    });
    send.mockResolvedValue('job-789');

    await service.publish('test-job', {
      tenantId: 'domain-tenant',
      foo: 'bar',
    });

    expect(send).toHaveBeenCalledWith('test-job', {
      tenantId: 'domain-tenant',
      foo: 'bar',
      requestId: 'req-1',
    });
  });

  it('should schedule a recurring cron for a queue', async () => {
    await service.schedule('audit.partition-maintain', '0 3 * * *', {});

    expect(createQueue).toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledWith(
      'audit.partition-maintain',
      '0 3 * * *',
      {},
    );
  });

  it('should send within a transaction using a TypeORM adapter', async () => {
    send.mockResolvedValue('job-tx');
    const manager = {
      query: jest.fn(),
    } as unknown as import('typeorm').EntityManager;

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
    const handler = jest.fn().mockResolvedValue(undefined);
    await service.registerWorker('audit.write', handler);

    expect(work).toHaveBeenCalledWith(
      'audit.write',
      expect.objectContaining({
        pollingIntervalSeconds: 2,
        localConcurrency: 2,
      }),
      expect.any(Function),
    );

    const [, , workHandler] = work.mock.calls[0] as [
      string,
      object,
      (jobs: Array<{ id: string }>) => Promise<void>,
    ];
    await workHandler([{ id: 'j1' }, { id: 'j2' }]);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should skip worker registration when disabled', async () => {
    await expect(
      service.registerWorker('audit.write', () => Promise.resolve(), {
        enabled: false,
      }),
    ).resolves.toBeNull();
    expect(work).not.toHaveBeenCalled();
  });

  it('should only create queues once under concurrent ensureQueues calls', async () => {
    await Promise.all([service.ensureQueues(), service.ensureQueues()]);

    // 9 queues + 9 DLQs
    expect(createQueue).toHaveBeenCalledTimes(18);

    await service.ensureQueues();
    expect(createQueue).toHaveBeenCalledTimes(18);
  });

  it('should retry ensureQueues after a previous failure', async () => {
    createQueue
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue(undefined);

    await expect(service.ensureQueues()).rejects.toThrow('transient');
    await expect(service.ensureQueues()).resolves.toBeUndefined();

    // First attempt fails mid-way after 1 call; second attempt creates 18.
    expect(createQueue).toHaveBeenCalledTimes(19);
  });

  it('should propagate errors from pg-boss', async () => {
    const error = new Error('send failed');

    send.mockRejectedValue(error);

    await expect(service.publish('test-job', {})).rejects.toThrow(
      'send failed',
    );
  });

  describe('job correlation', () => {
    const TRACEPARENT =
      '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const TENANT_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    const OPERATION_ID = '9c858901-8a57-4791-81fe-4c455b099bc9';

    type TestJob = { id: string; data: Record<string, unknown> };

    const startWorker = async (
      queueName: string,
      handler: (job: TestJob) => Promise<void>,
    ): Promise<(jobs: TestJob[]) => Promise<void>> => {
      await service.registerWorker(
        queueName,
        handler as unknown as (job: never) => Promise<void>,
      );

      const [, , workHandler] = work.mock.calls.at(-1) as [
        string,
        object,
        (jobs: TestJob[]) => Promise<void>,
      ];

      return workHandler;
    };

    /**
     * Runs one job against a stand-in tracer and hands back the attributes the
     * job span was opened with.
     */
    const jobSpanAttributes = async (
      queueName: string,
      data: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => {
      const span = {
        setStatus: jest.fn(),
        recordException: jest.fn(),
        end: jest.fn(),
      };
      const startActiveSpan = jest.fn(
        (
          _name: string,
          _options: unknown,
          _parent: unknown,
          callback: (span: unknown) => Promise<void>,
        ) => callback(span),
      );
      const getTracer = jest
        .spyOn(trace, 'getTracer')
        .mockReturnValue({ startActiveSpan } as unknown as Tracer);

      const workHandler = await startWorker(queueName, () => Promise.resolve());
      await workHandler([{ id: 'j1', data }]);

      getTracer.mockRestore();

      const [, options] = startActiveSpan.mock.calls.at(-1) as [
        string,
        { attributes: Record<string, unknown> },
      ];

      return options.attributes;
    };

    it('carries the trace context of the enqueuing request on the job data', async () => {
      const inject = jest
        .spyOn(propagation, 'inject')
        .mockImplementation((_context, carrier) => {
          (carrier as Record<string, string>).traceparent = TRACEPARENT;
        });
      send.mockResolvedValue('job-1');

      await service.publish('audit.write', { foo: 'bar' });

      expect(send).toHaveBeenCalledWith('audit.write', {
        foo: 'bar',
        traceparent: TRACEPARENT,
      });

      inject.mockRestore();
    });

    it('keeps propagator extras such as baggage off the job data', async () => {
      // The default propagators also emit `baggage`, which echoes whatever an
      // inbound request sent. Job data is persisted, and nothing reads it back.
      const inject = jest
        .spyOn(propagation, 'inject')
        .mockImplementation((_context, carrier) => {
          const target = carrier as Record<string, string>;
          target.traceparent = TRACEPARENT;
          target.baggage = 'user=someone,tier=gold';
        });
      send.mockResolvedValue('job-1');

      await service.publish('audit.write', { foo: 'bar' });

      expect(send).toHaveBeenCalledWith('audit.write', {
        foo: 'bar',
        traceparent: TRACEPARENT,
      });

      inject.mockRestore();
    });

    it('prefers the active trace context over one already on the data', async () => {
      const inject = jest
        .spyOn(propagation, 'inject')
        .mockImplementation((_context, carrier) => {
          (carrier as Record<string, string>).traceparent = TRACEPARENT;
        });
      send.mockResolvedValue('job-1');

      await service.publish('audit.write', {
        foo: 'bar',
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      });

      expect(send).toHaveBeenCalledWith('audit.write', {
        foo: 'bar',
        traceparent: TRACEPARENT,
      });

      inject.mockRestore();
    });

    it('runs a job inside the context the enqueuing request left on the payload', async () => {
      const workHandler = await startWorker('audit.write', () =>
        Promise.resolve(),
      );

      await workHandler([
        { id: 'j1', data: { requestId: 'req-1', tenantId: 'tenant-1' } },
      ]);

      expect(runRequestContext).toHaveBeenCalledWith(
        {
          source: 'job:audit.write',
          requestId: 'req-1',
          tenantId: 'tenant-1',
        },
        expect.any(Function),
      );
    });

    it('labels a job nobody requested without inventing a request id', async () => {
      const workHandler = await startWorker('audit.partition-maintain', () =>
        Promise.resolve(),
      );

      await workHandler([{ id: 'j1', data: {} }]);

      expect(runRequestContext).toHaveBeenCalledWith(
        { source: 'job:audit.partition-maintain' },
        expect.any(Function),
      );
    });

    it('does not carry one job identifiers into the next job of a batch', async () => {
      const workHandler = await startWorker('audit.write', () =>
        Promise.resolve(),
      );

      await workHandler([
        { id: 'j1', data: { requestId: 'req-1', tenantId: 'tenant-1' } },
        { id: 'j2', data: {} },
      ]);

      expect(runRequestContext.mock.calls.map(([store]) => store)).toEqual([
        { source: 'job:audit.write', requestId: 'req-1', tenantId: 'tenant-1' },
        { source: 'job:audit.write' },
      ]);
    });

    it('reads the trace context off the payload without copying it into the request context', async () => {
      const extract = jest.spyOn(propagation, 'extract');
      const workHandler = await startWorker('audit.write', () =>
        Promise.resolve(),
      );

      await workHandler([
        {
          id: 'j1',
          data: {
            requestId: 'req-1',
            traceparent: TRACEPARENT,
            tracestate: 'vendor=1',
            foo: 'bar',
          },
        },
      ]);

      expect(extract).toHaveBeenCalledWith(expect.anything(), {
        traceparent: TRACEPARENT,
        tracestate: 'vendor=1',
      });
      expect(runRequestContext).toHaveBeenCalledWith(
        { source: 'job:audit.write', requestId: 'req-1' },
        expect.any(Function),
      );

      extract.mockRestore();
    });

    it('logs a line for every completed job', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      const workHandler = await startWorker('audit.write', () =>
        Promise.resolve(),
      );

      await workHandler([{ id: 'j1', data: {} }]);

      expect(logSpy).toHaveBeenCalledWith(
        {
          duration_ms: expect.any(Number),
          job_id: 'j1',
          queue: 'audit.write',
        },
        'job completed',
      );

      logSpy.mockRestore();
    });

    it('logs a failing job and rethrows so pg-boss can retry it', async () => {
      const failure = new Error('handler blew up');
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      const workHandler = await startWorker('audit.write', () =>
        Promise.reject(failure),
      );

      await expect(
        workHandler([{ id: 'j1', data: { requestId: 'req-1' } }]),
      ).rejects.toThrow('handler blew up');

      expect(errorSpy).toHaveBeenCalledWith(
        {
          duration_ms: expect.any(Number),
          err: failure,
          job_id: 'j1',
          queue: 'audit.write',
        },
        'job failed',
      );

      errorSpy.mockRestore();
    });

    it('keeps the request operation id off the job payload', async () => {
      // audit.write persists operationId as the operation the record is
      // about, and leaves it unset when there is none. Injecting the
      // request's would be written to the record as if it were that
      // operation.
      getRequestContext.mockReturnValueOnce({
        requestId: 'req-1',
        operationId: OPERATION_ID,
      });
      send.mockResolvedValue('job-1');

      await service.publish('audit.write', { foo: 'bar' });

      expect(send).toHaveBeenCalledWith('audit.write', {
        foo: 'bar',
        requestId: 'req-1',
      });
    });

    it('restores the operation id the request left on the payload', async () => {
      const workHandler = await startWorker('audit.write', () =>
        Promise.resolve(),
      );

      await workHandler([
        { id: 'j1', data: { requestId: 'req-1', operationId: OPERATION_ID } },
      ]);

      expect(runRequestContext).toHaveBeenCalledWith(
        {
          source: 'job:audit.write',
          requestId: 'req-1',
          operationId: OPERATION_ID,
        },
        expect.any(Function),
      );
    });

    it('tags the job span with the tenant and operation it belongs to', async () => {
      const attributes = await jobSpanAttributes('audit.write', {
        tenantId: TENANT_ID,
        operationId: OPERATION_ID,
      });

      expect(attributes).toMatchObject({
        'tenant.id': TENANT_ID,
        'operation.id': OPERATION_ID,
      });
    });

    it('keeps identifiers that are not ids off the job span', async () => {
      const attributes = await jobSpanAttributes('audit.write', {
        tenantId: 'tenant-1',
        operationId: 'operation-1',
      });

      // Array form, because the string form would read the dot as a path
      // into a nested object and pass whatever the attribute held.
      expect(attributes).not.toHaveProperty(['tenant.id']);
      expect(attributes).not.toHaveProperty(['operation.id']);
    });
  });

  it('should shutdown the boss service', async () => {
    await service.shutdown();

    expect(stopService).toHaveBeenCalledTimes(1);
  });
});
