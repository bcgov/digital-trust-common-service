import { JOB_QUEUES } from '@app/pg-boss';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Job } from 'pg-boss';
import { DataSource, type EntityManager } from 'typeorm';

import { JobsService, SafeJobFailure } from '../jobs/jobs.service';
import {
  TenantUser,
  TenantUserStatus,
} from '../tenant-user/tenant-user.entity';
import { TenantUserRepository } from '../tenant-user/tenant-user.repository';

import { EmailSendQuotaRepository } from './email-send-quota.repository';
import { EmailDeliveryError, EmailProvider } from './email.provider';
import { EmailKind, type SendEmailRequest } from './email.service';
import { EmailWorker } from './email.worker';

describe('EmailWorker', () => {
  const jobs = { registerWorker: jest.fn(), deferInTransaction: jest.fn() };
  const tenantUsers = { findOne: jest.fn() };
  const provider = { send: jest.fn(), countsTowardQuota: true };
  const quota = { reserve: jest.fn() };
  const manager = {} as EntityManager;
  const job = {
    data: {
      kind: EmailKind.TENANT_INVITATION,
      tenantId: '11111111-1111-4111-8111-111111111111',
      invitationId: '22222222-2222-4222-8222-222222222222',
    },
  } as Job<SendEmailRequest>;
  const invitation = {
    email: 'invitee@example.test',
    tenant: { name: 'Example tenant' },
  };

  async function createWorker(withProvider = true, workersEnabled = true) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EmailWorker,
        TenantUserRepository,
        { provide: JobsService, useValue: jobs },
        { provide: EmailSendQuotaRepository, useValue: quota },
        {
          provide: DataSource,
          useValue: {
            transaction: (
              callback: (transaction: EntityManager) => Promise<void>,
            ) => callback(manager),
          },
        },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            APP_PUBLIC_URL: 'https://app.example.test',
            PG_BOSS_WORKERS_ENABLED: String(workersEnabled),
          }),
        },
        { provide: getRepositoryToken(TenantUser), useValue: tenantUsers },
        ...(withProvider
          ? [{ provide: EmailProvider, useValue: provider }]
          : []),
      ],
    }).compile();
    return moduleRef.get(EmailWorker);
  }

  beforeEach(() => {
    jest.resetAllMocks();
    quota.reserve.mockResolvedValue(null);
    provider.countsTowardQuota = true;
  });

  it.each([
    [true, true, true],
    [false, true, false],
    [true, false, false],
  ])(
    'registers with provider=%s and workers=%s: %s',
    async (bound, enabled, expected) => {
      const worker = await createWorker(bound, enabled);
      await worker.onModuleInit();

      expect(jobs.registerWorker).toHaveBeenCalledWith(
        JOB_QUEUES.EMAIL_SEND,
        expect.any(Function),
        { enabled: expected, includeMetadata: true },
      );
    },
  );

  it('resolves a pending invitation by tenant and delivers its template data', async () => {
    tenantUsers.findOne.mockResolvedValue(invitation);
    const worker = await createWorker();

    await worker.handle(job);

    expect(tenantUsers.findOne).toHaveBeenCalledWith({
      where: {
        id: job.data.invitationId,
        tenantId: job.data.tenantId,
        status: TenantUserStatus.INVITED,
      },
      relations: { tenant: true },
    });
    expect(provider.send).toHaveBeenCalledWith({
      kind: EmailKind.TENANT_INVITATION,
      to: invitation.email,
      tenantName: invitation.tenant.name,
      signInUrl: 'https://app.example.test/login',
    });
    expect(quota.reserve).toHaveBeenCalledWith(job.data.tenantId);
  });

  it('defers a capped job instead of sending it', async () => {
    tenantUsers.findOne.mockResolvedValue(invitation);
    const retryAt = new Date('2026-04-01T10:00:00Z');
    quota.reserve.mockResolvedValue(retryAt);
    const worker = await createWorker();

    await worker.handle(job);

    expect(jobs.deferInTransaction).toHaveBeenCalledWith(manager, job, retryAt);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('does not reserve a slot for log-only previews', async () => {
    tenantUsers.findOne.mockResolvedValue(invitation);
    provider.countsTowardQuota = false;
    const worker = await createWorker();

    await worker.handle(job);

    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(quota.reserve).not.toHaveBeenCalled();
  });

  it('skips an invitation that is no longer pending in the job tenant', async () => {
    tenantUsers.findOne.mockResolvedValue(null);
    const worker = await createWorker();

    await worker.handle(job);

    expect(provider.send).not.toHaveBeenCalled();
    expect(quota.reserve).not.toHaveBeenCalled();
  });

  it('rejects malformed payloads before looking up an invitation', async () => {
    const worker = await createWorker();

    await expect(
      worker.handle({ ...job, data: { ...job.data, tenantId: '' } }),
    ).rejects.toThrow('Invalid email job payload.');
    expect(tenantUsers.findOne).not.toHaveBeenCalled();
  });

  it.each([
    [
      new Error(`Rejected ${invitation.email}`),
      'Email provider failed to send invitation.',
    ],
    [
      new EmailDeliveryError('SMTP hostname could not be resolved.'),
      'SMTP hostname could not be resolved.',
    ],
  ])(
    'fails the job with a safe delivery reason for %s',
    async (error, reason) => {
      tenantUsers.findOne.mockResolvedValue(invitation);
      provider.send.mockRejectedValue(error);
      const worker = await createWorker();

      await expect(worker.handle(job)).rejects.toStrictEqual(
        new SafeJobFailure(reason),
      );
    },
  );
});
