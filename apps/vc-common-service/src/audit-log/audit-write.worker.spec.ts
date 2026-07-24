import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Job } from 'pg-boss';

import { JobsService } from '../jobs/jobs.service';

import { AuditAction, AuditActorType } from './audit-log.entity';
import { AuditLogService } from './audit-log.service';
import { AuditWriteJobData, AuditWriteWorker } from './audit-write.worker';

describe('AuditWriteWorker', () => {
  let worker: AuditWriteWorker;
  let mockRegisterWorker: jest.Mock;
  let mockPublish: jest.Mock;
  let mockWrite: jest.Mock;

  beforeEach(async () => {
    mockRegisterWorker = jest.fn().mockResolvedValue('worker-1');
    mockPublish = jest.fn().mockResolvedValue('job-1');
    mockWrite = jest.fn().mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditWriteWorker,
        {
          provide: JobsService,
          useValue: {
            registerWorker: mockRegisterWorker,
            publish: mockPublish,
          },
        },
        {
          provide: AuditLogService,
          useValue: { write: mockWrite },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((_key: string, fallback?: string) => fallback),
          },
        },
      ],
    }).compile();

    worker = module.get(AuditWriteWorker);
  });

  it('registers the audit.write worker on init', async () => {
    await worker.onModuleInit();

    expect(mockRegisterWorker).toHaveBeenCalledWith(
      'audit.write',
      expect.any(Function),
      { enabled: true },
    );
  });

  it('writes an audit log from a job payload', async () => {
    const job = {
      id: 'job-1',
      data: {
        tenantId: '123e4567-e89b-12d3-a456-426614174001',
        actorId: 'user-1',
        actorType: AuditActorType.USER,
        action: AuditAction.LOGIN,
        resourceType: 'session',
        resourceId: '123e4567-e89b-12d3-a456-426614174099',
      },
    } as Job<AuditWriteJobData>;

    await worker.handle(job);

    expect(mockWrite).toHaveBeenCalledWith(job.data);
  });

  it('rejects invalid payloads', async () => {
    await expect(
      worker.handle({ id: 'x', data: {} } as Job<AuditWriteJobData>),
    ).rejects.toThrow('Invalid audit.write payload');
  });

  it('rejects payloads missing resource fields', async () => {
    await expect(
      worker.handle({
        id: 'x',
        data: {
          tenantId: '123e4567-e89b-12d3-a456-426614174001',
          actorId: 'user-1',
          actorType: AuditActorType.USER,
          action: AuditAction.LOGIN,
        },
      } as Job<AuditWriteJobData>),
    ).rejects.toThrow('Invalid audit.write payload');
  });

  it('rejects non-uuid resource ids', async () => {
    await expect(
      worker.handle({
        id: 'x',
        data: {
          tenantId: '123e4567-e89b-12d3-a456-426614174001',
          actorId: 'user-1',
          actorType: AuditActorType.USER,
          action: AuditAction.LOGIN,
          resourceType: 'session',
          resourceId: 'not-a-uuid',
        },
      } as Job<AuditWriteJobData>),
    ).rejects.toThrow('Invalid audit.write payload');
  });

  it('enqueues audit.write jobs', async () => {
    const payload: AuditWriteJobData = {
      tenantId: '123e4567-e89b-12d3-a456-426614174001',
      actorId: 'system',
      actorType: AuditActorType.SYSTEM,
      action: AuditAction.CREATE,
      resourceType: 'tenant',
      resourceId: '123e4567-e89b-12d3-a456-426614174001',
    };

    await expect(worker.enqueue(payload)).resolves.toBe('job-1');
    expect(mockPublish).toHaveBeenCalledWith('audit.write', payload);
  });
});
