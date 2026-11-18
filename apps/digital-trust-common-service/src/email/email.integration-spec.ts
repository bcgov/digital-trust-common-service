import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

import { RequestContextService } from '@app/common/context/request-context.service';
import { createTestTenant } from '@app/credential-ports/testing/test-data.factory';
import { buildSslConfig } from '@app/database/ssl.util';
import {
  JOB_DEAD_LETTER_QUEUES,
  JOB_QUEUES,
  PgBossService,
} from '@app/pg-boss';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { PgBoss } from 'pg-boss';
import { DataSource, In } from 'typeorm';

import { JobsService } from '../jobs/jobs.service';
import { SEED_ENTITIES } from '../seed/seed.constants';
import { ShutdownRegistry } from '../shutdown/shutdown-registry';
import { Tenant } from '../tenant/tenant.entity';
import {
  TenantUser,
  TenantUserStatus,
} from '../tenant-user/tenant-user.entity';
import { TenantUserRepository } from '../tenant-user/tenant-user.repository';

import { EmailSendQuotaRepository } from './email-send-quota.repository';
import { EmailDeliveryError, EmailProvider } from './email.provider';
import {
  EmailKind,
  EmailService,
  type SendEmailRequest,
} from './email.service';
import { EmailWorker } from './email.worker';

describe('Email delivery (integration)', () => {
  jest.setTimeout(30_000);

  const schema = `email_test_${randomUUID().replaceAll('-', '')}`;
  const provider = { countsTowardQuota: true, send: jest.fn() };
  let dataSource: DataSource;
  let boss: PgBoss;
  let moduleRef: TestingModule;
  let email: EmailService;
  let worker: EmailWorker;
  let tenantIds: string[] = [];
  let invitation: TenantUser;
  let request: SendEmailRequest;
  const bossErrors: Error[] = [];

  async function releaseRetry(id: string, retryCount = 0): Promise<void> {
    await waitForState(id, 'retry', retryCount);
    const job = await boss.getJobById(JOB_QUEUES.EMAIL_SEND, id);
    expect(job?.startAfter.getTime()).toBeGreaterThan(Date.now());
    await dataSource.query(
      `UPDATE "${schema}".job SET start_after = now() WHERE id = $1 AND name = $2`,
      [id, JOB_QUEUES.EMAIL_SEND],
    );
  }

  async function quotaAttempts(tenantId: string): Promise<number> {
    const rows: { count: number }[] = await dataSource.query(
      'SELECT cardinality(attempts) AS count FROM email_send_quota WHERE tenant_id = $1',
      [tenantId],
    );
    return rows[0]?.count ?? 0;
  }

  async function waitForState(
    id: string,
    state: string,
    retryCount?: number,
  ): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const job = await boss.getJobById(JOB_QUEUES.EMAIL_SEND, id);
      if (
        job?.state === state &&
        (retryCount === undefined || job.retryCount === retryCount)
      ) {
        return;
      }
      await setTimeout(25);
    }
    const job = await boss.getJobById(JOB_QUEUES.EMAIL_SEND, id);
    throw new Error(`Expected ${state}, received ${job?.state}`);
  }

  beforeAll(async () => {
    const ssl = buildSslConfig(
      process.env.DB_SSL,
      process.env.DB_SSL_REJECT_UNAUTHORIZED,
      process.env.DB_SSL_CA,
    );
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      entities: [...SEED_ENTITIES],
      ssl,
    });
    await dataSource.initialize();
    boss = new PgBoss({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl,
      schema,
      schedule: false,
      supervise: false,
    });
    boss.on('error', (error: Error) => bossErrors.push(error));
    await boss.start();
    moduleRef = await Test.createTestingModule({
      providers: [
        EmailService,
        EmailWorker,
        EmailSendQuotaRepository,
        TenantUserRepository,
        JobsService,
        ShutdownRegistry,
        RequestContextService,
        EventEmitter2,
        { provide: PgBossService, useValue: { boss } },
        { provide: DataSource, useValue: dataSource },
        {
          provide: getRepositoryToken(TenantUser),
          useValue: dataSource.getRepository(TenantUser),
        },
        { provide: EmailProvider, useValue: provider },
        { provide: PinoLogger, useValue: { error: jest.fn() } },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            NODE_ENV: 'test',
            APP_PUBLIC_URL: 'https://email.example.test',
            PG_BOSS_POLLING_INTERVAL_SECONDS: '0.5',
            PG_BOSS_LOCAL_CONCURRENCY: '1',
          }),
        },
      ],
    }).compile();
    email = moduleRef.get(EmailService);
    worker = moduleRef.get(EmailWorker);
    await moduleRef.get(JobsService).ensureQueues();
  });

  beforeEach(async () => {
    bossErrors.length = 0;
    provider.send.mockReset().mockResolvedValue(undefined);
    provider.countsTowardQuota = true;
    const tenants = [createTestTenant(), createTestTenant()];
    tenantIds = tenants.map(({ id }) => id);
    await dataSource
      .getRepository(Tenant)
      .insert(tenants.map(({ id, name, slug }) => ({ id, name, slug })));
    invitation = await dataSource.getRepository(TenantUser).save({
      tenantId: tenantIds[0],
      email: `invitee-${randomUUID()}@example.test`,
      status: TenantUserStatus.INVITED,
    });
    request = {
      kind: EmailKind.TENANT_INVITATION,
      tenantId: invitation.tenantId,
      invitationId: invitation.id,
    };
  });

  afterEach(async () => {
    if (boss) {
      await boss.offWork(JOB_QUEUES.EMAIL_SEND);
      await boss.deleteAllJobs();
    }
    if (dataSource?.isInitialized && tenantIds.length) {
      await dataSource.getRepository(Tenant).delete({ id: In(tenantIds) });
    }
    expect(bossErrors).toEqual([]);
  });

  afterAll(async () => {
    await boss?.stop();
    await moduleRef?.close();
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await dataSource.destroy();
    }
  });

  it('delivers an enqueued invitation through the registered worker', async () => {
    const id = await email.enqueue(request);
    expect(id).not.toBeNull();
    await worker.onModuleInit();
    await waitForState(id!, 'completed');

    expect(provider.send).toHaveBeenCalledTimes(1);
    const tenant = await dataSource.getRepository(Tenant).findOneByOrFail({
      id: invitation.tenantId,
    });
    expect(provider.send).toHaveBeenCalledWith({
      kind: request.kind,
      to: invitation.email,
      tenantName: tenant.name,
      signInUrl: 'https://email.example.test/login',
    });
  });

  it('rolls back an invitation and its queued email together', async () => {
    let id: string | null = null;
    const invitationId = randomUUID();
    await expect(
      dataSource.transaction(async (manager) => {
        await manager.insert(TenantUser, {
          id: invitationId,
          tenantId: invitation.tenantId,
          email: `rollback-${randomUUID()}@example.test`,
          status: TenantUserStatus.INVITED,
        });
        id = await email.enqueue({ ...request, invitationId }, manager);
        expect(id).not.toBeNull();
        throw new Error('Rollback fixture');
      }),
    ).rejects.toThrow('Rollback fixture');

    expect(await boss.getJobById(JOB_QUEUES.EMAIL_SEND, id!)).toBeNull();
    expect(
      await dataSource
        .getRepository(TenantUser)
        .findOneBy({ id: invitationId }),
    ).toBeNull();
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('only exposes a transactionally enqueued job after commit', async () => {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let id: string | null = null;
    try {
      id = await email.enqueue(request, runner.manager);
      expect(id).not.toBeNull();
      expect(await boss.getJobById(JOB_QUEUES.EMAIL_SEND, id!)).toBeNull();
      await runner.commitTransaction();
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
    await worker.onModuleInit();
    await waitForState(id!, 'completed');
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('persists identifiers rather than recipient or template data', async () => {
    const supplied = {
      ...request,
      to: invitation.email,
      tenantName: 'Not persisted',
      signInUrl: 'https://untrusted.example.test',
    };
    const id = await email.enqueue(supplied);
    const job = await boss.getJobById(JOB_QUEUES.EMAIL_SEND, id!);

    expect(job?.data).toEqual(request);
  });

  it('does not reserve quota for a provider exempt from the cap', async () => {
    provider.countsTowardQuota = false;
    await dataSource.query(
      'INSERT INTO email_send_quota (tenant_id, attempts) VALUES ($1, array_fill(statement_timestamp(), ARRAY[100]))',
      [invitation.tenantId],
    );
    const id = await email.enqueue(request);
    await worker.onModuleInit();
    await waitForState(id!, 'completed');

    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(await quotaAttempts(invitation.tenantId)).toBe(100);
  });

  it.each(['other tenant', 'active', 'disabled', 'deleted'])(
    'does not deliver an invitation belonging to %s',
    async (scenario) => {
      if (scenario === 'other tenant') {
        request.tenantId = tenantIds[1];
      } else if (scenario === 'deleted') {
        await dataSource.getRepository(TenantUser).delete(invitation.id);
      } else {
        await dataSource.getRepository(TenantUser).update(invitation.id, {
          status:
            scenario === 'active'
              ? TenantUserStatus.ACTIVE
              : TenantUserStatus.DISABLED,
        });
      }
      const id = await email.enqueue(request);
      await worker.onModuleInit();
      await waitForState(id!, 'completed');

      expect(provider.send).not.toHaveBeenCalled();
      expect(await quotaAttempts(invitation.tenantId)).toBe(0);
      expect(await quotaAttempts(tenantIds[1])).toBe(0);
    },
  );

  it('retries a transient failure and counts both delivery attempts', async () => {
    provider.send.mockRejectedValueOnce(
      new EmailDeliveryError('SMTP server did not respond in time.'),
    );
    const id = await email.enqueue(request);
    await worker.onModuleInit();
    await releaseRetry(id!);
    await waitForState(id!, 'completed');

    expect(provider.send).toHaveBeenCalledTimes(2);
    expect(await quotaAttempts(invitation.tenantId)).toBe(2);
    expect(
      (await boss.getJobById(JOB_QUEUES.EMAIL_SEND, id!))?.retryCount,
    ).toBe(1);
  });

  it('exhausts three retries, then moves the job to its dead-letter queue', async () => {
    provider.send.mockRejectedValue(
      new EmailDeliveryError('SMTP authentication failed.'),
    );
    const id = await email.enqueue(request);
    const queued = await boss.getJobById(JOB_QUEUES.EMAIL_SEND, id!);
    expect(queued).toMatchObject({
      retryLimit: 3,
      retryDelay: 60,
      retryBackoff: true,
    });
    await worker.onModuleInit();
    for (let attempt = 0; attempt < 3; attempt++) {
      await releaseRetry(id!, attempt);
    }
    await waitForState(id!, 'failed');

    expect(provider.send).toHaveBeenCalledTimes(4);
    expect(await quotaAttempts(invitation.tenantId)).toBe(4);
    const deadLetters = await boss.fetch<SendEmailRequest>(
      JOB_DEAD_LETTER_QUEUES.EMAIL_SEND,
    );
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0].data).toEqual(request);
  });

  it('defers a capped retry atomically without resetting its retry budget', async () => {
    provider.send.mockRejectedValueOnce(
      new EmailDeliveryError('SMTP server did not respond in time.'),
    );
    const id = await email.enqueue(request);
    await worker.onModuleInit();
    await waitForState(id!, 'retry');
    await dataSource.query(
      'UPDATE email_send_quota SET attempts = array_fill(statement_timestamp(), ARRAY[100]) WHERE tenant_id = $1',
      [invitation.tenantId],
    );
    await releaseRetry(id!);
    await waitForState(id!, 'completed');
    const replacements: { id: string }[] = await dataSource.query(
      `SELECT id FROM "${schema}".job WHERE name = $1 AND id <> $2`,
      [JOB_QUEUES.EMAIL_SEND, id],
    );
    expect(replacements).toHaveLength(1);
    const replacement = await boss.getJobById<SendEmailRequest>(
      JOB_QUEUES.EMAIL_SEND,
      replacements[0].id,
    );
    expect(replacement).toMatchObject({
      state: 'created',
      data: request,
      retryLimit: 2,
      retryCount: 0,
    });
    expect(replacement!.startAfter.getTime()).toBeGreaterThan(
      Date.now() + 59 * 60_000,
    );
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(await quotaAttempts(invitation.tenantId)).toBe(100);
  });

  it('rolls back completion when a deferred replacement cannot be inserted', async () => {
    const id = await email.enqueue(request);
    const [job] = await boss.fetch<SendEmailRequest>(JOB_QUEUES.EMAIL_SEND, {
      includeMetadata: true,
    });
    const send = jest
      .spyOn(boss, 'send')
      .mockRejectedValueOnce(new Error('Replacement unavailable'));
    try {
      await expect(
        dataSource.transaction((manager) =>
          moduleRef
            .get(JobsService)
            .deferInTransaction(manager, job, new Date(Date.now() + 60_000)),
        ),
      ).rejects.toThrow('Replacement unavailable');
    } finally {
      send.mockRestore();
    }
    expect((await boss.getJobById(JOB_QUEUES.EMAIL_SEND, id!))?.state).toBe(
      'active',
    );
    const rows: { count: number }[] = await dataSource.query(
      `SELECT count(*)::int AS count FROM "${schema}".job WHERE name = $1`,
      [JOB_QUEUES.EMAIL_SEND],
    );
    expect(rows[0].count).toBe(1);
  });
});
