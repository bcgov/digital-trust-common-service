import type { Server } from 'node:http';

import { JwtGuard, ScopeAuthorizationService } from '@app/auth';
import type { AuthContext } from '@app/auth';
import { RequestContextService } from '@app/common/context/request-context.service';
import { AppDataSource } from '@app/database/data-source';
import { AddAuditReadAction1793733978162 } from '@app/database/migrations/000039_add-audit-read-action';
import { buildSslConfig } from '@app/database/ssl.util';
import { ExecutionContext, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, LessThan } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { configureApp } from '../app.config';
import {
  AuditAction,
  AuditActorType,
  AuditLog,
} from '../audit-log/audit-log.entity';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { decodeCursor, encodeCursor } from '../common/cursor-pagination';
import { BusinessMetricsService } from '../common/telemetry/business-metrics.service';
import { ConnectionService } from '../connection/connection.service';
import { CredentialRepository } from '../credential/credential.repository';
import { CredentialExchange } from '../credential-exchange/credential-exchange.entity';
import { CredentialExchangeRepository } from '../credential-exchange/credential-exchange.repository';
import { JobsService } from '../jobs/jobs.service';
import { ProtocolStateChangeService } from '../protocol-state-change/protocol-state-change.service';
import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
import { SEED_ENTITIES } from '../seed/seed.constants';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';
import { Tenant } from '../tenant/tenant.entity';
import { TenantService } from '../tenant/tenant.service';

import { OperationController } from './operation.controller';
import { Operation, OperationState } from './operation.entity';
import { OperationRepository } from './operation.repository';
import { OperationService } from './operation.service';

type HttpOperation = {
  id: string;
  batch_id: string | null;
  updated_at: string;
  result: unknown;
};

type HttpOperationPage = {
  data: HttpOperation[];
  pagination: { next_cursor: string | null; has_more: boolean };
};

/**
 * Tenant isolation for the polling endpoint at the SQL layer: the
 * repository filter is what turns another tenant's operation id into a 404.
 * Guard-level claim-match (403) is covered by jwt-guard.integration-spec.ts.
 */
describe('operation tenant isolation integration', () => {
  let dataSource: DataSource;
  let repository: OperationRepository;
  let service: OperationService;
  let protocolStateChanges: ProtocolStateChangeService;
  let app: INestApplication<Server>;
  let tenantAId: string;
  let tenantBId: string;
  let tenantAOperationId: string;

  const insertTenant = async (label: string): Promise<string> => {
    const rows = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO tenant (name, slug, status)
       VALUES ($1, $2, 'active')
       RETURNING id`,
      [`Operation Integration ${label}`, `operation-it-${label}-${Date.now()}`],
    );

    return rows[0].id;
  };

  beforeAll(async () => {
    // The real migration list and the shared entity set, not hand-maintained
    // copies: Operation relates to Tenant, which relates on to TenantUser, so a
    // partial entity list fails metadata build, and a partial migration list
    // only passes when a sibling spec happens to have migrated further first.
    dataSource = new DataSource({
      ...AppDataSource.options,
      entities: [...SEED_ENTITIES, AuditLog, CredentialExchange],
      ssl: buildSslConfig(
        process.env.DB_SSL,
        process.env.DB_SSL_REJECT_UNAUTHORIZED,
        process.env.DB_SSL_CA,
      ),
    } as DataSource['options']);

    await dataSource.initialize();
    await dataSource.runMigrations();

    repository = new OperationRepository(dataSource.getRepository(Operation));
    const module = await Test.createTestingModule({
      controllers: [OperationController],
      providers: [
        ConfigService,
        RequestContextService,
        ScopeAuthorizationService,
        OperationService,
        ProtocolStateChangeService,
        { provide: AdapterRegistry, useValue: { resolve: jest.fn() } },
        { provide: DataSource, useValue: dataSource },
        {
          provide: CredentialRepository,
          useValue: { findByExternalId: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: CredentialExchangeRepository,
          useValue: new CredentialExchangeRepository(
            dataSource.getRepository(CredentialExchange),
          ),
        },
        { provide: ConnectionService, useValue: {} },
        {
          provide: JobsService,
          useValue: { sendInTransaction: jest.fn().mockResolvedValue('job') },
        },
        {
          provide: DomainAuditService,
          useValue: { emit: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: OperationRepository, useValue: repository },
        {
          provide: TenantService,
          useValue: {
            findById: (id: string) =>
              dataSource.getRepository(Tenant).findOneByOrFail({ id }),
          },
        },
        {
          provide: BusinessMetricsService,
          useValue: { recordCredentialOperation: jest.fn() },
        },
        {
          provide: AuditLogService,
          useValue: new AuditLogService(
            new AuditLogRepository(dataSource.getRepository(AuditLog)),
          ),
        },
      ],
    })
      .overrideGuard(JwtGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context
            .switchToHttp()
            .getRequest<{ auth: Partial<AuthContext> }>().auth = {
            sub: 'readonly-reader',
            tokenType: 'user',
            tenantId: tenantAId,
            roles: ['readonly'],
            scopes: [],
            scope: '',
          };
          return true;
        },
      })
      .overrideGuard(TenantStatusGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(TenantTierRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();
    service = module.get(OperationService);
    protocolStateChanges = module.get(ProtocolStateChangeService);
    app = module.createNestApplication();
    configureApp(app);
    await app.init();

    tenantAId = await insertTenant('a');
    tenantBId = await insertTenant('b');

    const operations = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO operation (
         tenant_id, type, state, request, expires_at
       ) VALUES (
         $1,
         'credential.offer',
         'completed',
         '{"method":"POST","path":"/x","body":{"given_name":"Alice"}}'::jsonb,
         NOW() + INTERVAL '72 hours'
       )
       RETURNING id`,
      [tenantAId],
    );
    tenantAOperationId = operations[0].id;
  });

  afterAll(async () => {
    await app?.close();
    if (dataSource?.isInitialized) {
      // Operation first: its tenant FK is onDelete RESTRICT, and the rows would
      // otherwise accumulate in the shared test database on every run.
      await dataSource.query(
        `DELETE FROM operation WHERE tenant_id = ANY($1)`,
        [[tenantAId, tenantBId]],
      );
      await dataSource.query(`DELETE FROM tenant WHERE id = ANY($1)`, [
        [tenantAId, tenantBId],
      ]);

      await dataSource.destroy();
    }
  });

  it('returns the operation for its owning tenant', async () => {
    const operation = await repository.findByIdForTenant(
      tenantAOperationId,
      tenantAId,
    );

    expect(operation?.id).toBe(tenantAOperationId);
    expect(operation?.state).toBe(OperationState.COMPLETED);
  });

  it('stamps the first view once, without moving updated_at', async () => {
    // Against the real driver: query() returns [rows, rowCount] for a bare
    // UPDATE, so the CTE shape is load-bearing and a mocked row array cannot
    // prove it. Also pins the single-shot guard and the untouched updated_at.
    const [before] = await dataSource.query<Array<{ updated_at: Date }>>(
      `SELECT updated_at FROM operation WHERE id = $1`,
      [tenantAOperationId],
    );

    const viewedAt = new Date();
    const expiresAt = new Date(viewedAt.getTime() + 60 * 60 * 1000);

    const first = await repository.markFirstView(
      tenantAOperationId,
      viewedAt,
      expiresAt,
    );
    const second = await repository.markFirstView(
      tenantAOperationId,
      new Date(viewedAt.getTime() + 60_000),
      new Date(expiresAt.getTime() + 60_000),
    );

    expect(first?.viewedAt).toBeInstanceOf(Date);
    expect(first?.expiresAt.getTime()).toBe(expiresAt.getTime());
    expect(second).toBeNull();

    const [after] = await dataSource.query<Array<{ updated_at: Date }>>(
      `SELECT updated_at FROM operation WHERE id = $1`,
      [tenantAOperationId],
    );

    expect(after.updated_at.getTime()).toBe(before.updated_at.getTime());
  });

  it('paginates timestamp ties without skips, duplicates, or foreign rows', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const operationRepo = dataSource.getRepository(Operation);
    const create = (tenantId: string, state: OperationState, type: string) =>
      operationRepo.create({
        tenantId,
        type,
        state,
        request: { method: 'POST', path: '/test', body: {} },
        createdAt,
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      });
    const operations = await operationRepo.save([
      create(tenantAId, OperationState.PENDING, 'test.pagination'),
      create(tenantAId, OperationState.PENDING, 'test.pagination'),
      create(tenantAId, OperationState.PENDING, 'test.pagination'),
      create(tenantAId, OperationState.COMPLETED, 'test.pagination'),
      create(tenantAId, OperationState.PENDING, 'test.other'),
      create(tenantBId, OperationState.PENDING, 'test.pagination'),
    ]);
    const filters = {
      tenantId: tenantAId,
      type: 'test.pagination',
      state: OperationState.PENDING,
      limit: 2,
    };

    const first = await repository.findPageForTenant(filters);
    expect(first.hasMore).toBe(true);
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const cursor = decodeCursor(encodeCursor(first.nextCursor!));
    const second = await repository.findPageForTenant({ ...filters, cursor });

    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();
    expect(second.items).toHaveLength(1);
    expect([...first.items, ...second.items].map(({ id }) => id)).toEqual(
      operations
        .slice(0, 3)
        .map(({ id }) => id)
        .sort()
        .reverse(),
    );
    expect(
      [...first.items, ...second.items].every(
        (operation) => operation.tenantId === tenantAId,
      ),
    ).toBe(true);
  });

  it('scopes batch pages, counts, and capped failures to the tenant and batch', async () => {
    const operationRepo = dataSource.getRepository(Operation);
    const parent = await repository.save(
      repository.create({
        tenantId: tenantAId,
        type: 'credential.offer-batch',
        state: OperationState.PROCESSING,
        request: { method: 'POST', path: '/test', body: {} },
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      }),
    );
    const createChild = (
      state: OperationState,
      tenantId = tenantAId,
      batchId: string | null = parent.id,
    ) =>
      operationRepo.create({
        tenantId,
        batchId,
        type: 'credential.offer',
        state,
        request: { method: 'POST', path: '/test', body: {} },
        result:
          state === OperationState.FAILED
            ? { code: 'TEST_FAILURE', message: 'Test failure' }
            : null,
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      });
    await operationRepo.save([
      ...Array.from({ length: 101 }, () => createChild(OperationState.FAILED)),
      createChild(OperationState.PENDING),
      createChild(OperationState.PROCESSING),
      createChild(OperationState.COMPLETED),
      createChild(OperationState.FAILED, tenantBId),
      createChild(OperationState.FAILED, tenantAId, null),
    ]);

    await expect(
      repository.countByBatchGroupedByState(parent.id, tenantAId),
    ).resolves.toEqual({
      pending: 1,
      processing: 1,
      completed: 1,
      failed: 101,
    });
    const failures = await repository.findFailedBatchItemsForTenant(
      parent.id,
      tenantAId,
    );
    expect(failures).toHaveLength(100);
    expect(
      failures.every(
        (operation) =>
          operation.tenantId === tenantAId &&
          operation.batchId === parent.id &&
          operation.state === OperationState.FAILED,
      ),
    ).toBe(true);

    const first = await repository.findPageForTenant({
      tenantId: tenantAId,
      batchId: parent.id,
      state: OperationState.FAILED,
      limit: 100,
    });
    expect(first.items.map(({ id }) => id)).toEqual(
      failures.map(({ id }) => id),
    );
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();
    const second = await repository.findPageForTenant({
      tenantId: tenantAId,
      batchId: parent.id,
      state: OperationState.FAILED,
      limit: 100,
      cursor: decodeCursor(encodeCursor(first.nextCursor!)),
    });
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...first.items, ...second.items].map(({ id }) => id)).size,
    ).toBe(101);
  });

  it('fingerprints child state changes even when counts stay equal and excludes foreign rows', async () => {
    const operationRepo = dataSource.getRepository(Operation);
    const parent = await operationRepo.save(
      operationRepo.create({
        tenantId: tenantAId,
        type: 'credential.offer-batch',
        request: { method: 'POST', path: '/test', body: {} },
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      }),
    );
    const beforeEmpty = await repository.findBatchStateFingerprintForTenant(
      parent.id,
      tenantAId,
    );
    const children = await operationRepo.save(
      [
        { tenantId: tenantAId, state: OperationState.PENDING },
        { tenantId: tenantAId, state: OperationState.PROCESSING },
        { tenantId: tenantBId, state: OperationState.PENDING },
      ].map((child) =>
        operationRepo.create({
          ...child,
          batchId: parent.id,
          type: 'credential.offer',
          request: { method: 'POST', path: '/test', body: {} },
          expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
        }),
      ),
    );
    const fingerprint = await repository.findBatchStateFingerprintForTenant(
      parent.id,
      tenantAId,
    );
    expect(fingerprint).not.toBe(beforeEmpty);
    await operationRepo.update(
      { id: children[2].id, tenantId: tenantBId },
      { state: OperationState.FAILED },
    );
    expect(
      await repository.findBatchStateFingerprintForTenant(parent.id, tenantAId),
    ).toBe(fingerprint);
    const counts = await repository.countByBatchGroupedByState(
      parent.id,
      tenantAId,
    );
    await operationRepo.update(
      { id: children[0].id, tenantId: tenantAId },
      { state: OperationState.PROCESSING },
    );
    await operationRepo.update(
      { id: children[1].id, tenantId: tenantAId },
      { state: OperationState.PENDING },
    );
    expect(
      await repository.countByBatchGroupedByState(parent.id, tenantAId),
    ).toEqual(counts);
    expect(
      await repository.findBatchStateFingerprintForTenant(parent.id, tenantAId),
    ).not.toBe(fingerprint);
    expect(
      await repository.findBatchStateFingerprintForTenant(
        tenantAOperationId,
        tenantAId,
      ),
    ).toBe(beforeEmpty);
  });

  it('audits original-request access without persisting its PII in audit metadata', async () => {
    const operation = await repository.save(
      repository.create({
        tenantId: tenantAId,
        type: 'credential.offer',
        state: OperationState.COMPLETED,
        request: {
          method: 'POST',
          path: '/test',
          body: { given_name: 'Alice' },
        },
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      }),
    );
    const before = Date.now();
    for (const tokenType of ['user', 'client'] as const) {
      await expect(
        service.getRequestForTenant(tenantAId, operation.id, {
          sub: `reader-${tokenType}`,
          tokenType,
        }),
      ).resolves.toEqual(operation.request);
    }
    await expect(
      service.getRequestForTenant(tenantBId, operation.id, {
        sub: 'foreign-reader',
        tokenType: 'user',
      }),
    ).rejects.toThrow('Operation not found');

    const entries = await dataSource.getRepository(AuditLog).find({
      where: { tenantId: tenantAId, resourceId: operation.id },
      order: { createdAt: 'ASC' },
    });
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.actorType)).toEqual([
      AuditActorType.USER,
      AuditActorType.CLIENT,
    ]);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        action: AuditAction.READ,
        resourceType: 'operation_request',
        resourceId: operation.id,
        operationId: operation.id,
        actorId: `reader-${entry.actorType}`,
      });
      expect(Object.keys(entry.metadata)).toEqual(['accessed_at']);
      expect(
        Date.parse(entry.metadata.accessed_at as string),
      ).toBeGreaterThanOrEqual(before);
      expect(entry.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    }
    const stored = await repository.findByIdForTenant(operation.id, tenantAId);
    expect(stored?.viewedAt).toBeInstanceOf(Date);
    expect(stored?.expiresAt.getTime()).toBe(
      stored!.viewedAt!.getTime() + 60 * 60 * 1000,
    );
    expect(stored?.request).toEqual(operation.request);
  });

  it.each([false, true])(
    'safely rolls back the read action only without retained read entries (%s)',
    async (hasRead) => {
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query('CREATE SCHEMA operation_audit_rollback_test');
        await runner.query(
          'SET LOCAL search_path TO operation_audit_rollback_test',
        );
        await runner.query(`
        CREATE TYPE audit_action_enum AS ENUM (
          'issue', 'verify', 'hold', 'revoke', 'create', 'update', 'delete',
          'login', 'token_grant', 'read'
        );
        CREATE TABLE audit_log (action audit_action_enum NOT NULL, created_at timestamptz NOT NULL)
          PARTITION BY RANGE (created_at);
        CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;
      `);
        await runner.query('INSERT INTO audit_log VALUES ($1, NOW())', [
          hasRead ? 'read' : 'create',
        ]);
        const down = new AddAuditReadAction1793733978162().down(runner);
        if (hasRead) {
          await expect(down).rejects.toThrow('Cannot remove read action');
        } else {
          await down;
          const values = await runner.manager.query<Array<{ value: string }>>(
            `SELECT unnest(enum_range(NULL::audit_action_enum))::text AS value`,
          );
          expect(values.map(({ value }) => value)).not.toContain('read');
          expect(
            await runner.query('SELECT action::text AS action FROM audit_log'),
          ).toEqual([{ action: 'create' }]);
        }
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
    },
  );

  it('allows readonly HTTP reads without API scopes and durably audits request disclosure', async () => {
    const operation = await repository.save(
      repository.create({
        tenantId: tenantAId,
        type: 'test.http',
        state: OperationState.COMPLETED,
        request: {
          method: 'POST',
          path: '/test',
          body: { given_name: 'Alice' },
        },
        result: { reference: 'completed-result' },
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      }),
    );
    const foreign = await repository.save(
      repository.create({
        tenantId: tenantBId,
        type: 'test.http',
        state: OperationState.PENDING,
        request: { method: 'POST', path: '/test', body: {} },
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      }),
    );
    const base = `/api/v1/tenants/${tenantAId}/operations`;
    const list = await request(app.getHttpServer())
      .get(base)
      .query({ type: 'test.http', state: 'completed', limit: 20 })
      .expect(200);
    const listBody = list.body as HttpOperationPage;
    expect(listBody.data.map((item) => item.id)).toEqual([operation.id]);
    expect(listBody.data[0]).not.toHaveProperty('request');
    expect(listBody.data[0].result).toEqual({ reference: 'completed-result' });
    const detail = await request(app.getHttpServer())
      .get(`${base}/${operation.id}`)
      .expect(200);
    const detailBody = detail.body as HttpOperation;
    expect(Object.keys(detailBody).sort()).toEqual([
      'batch_id',
      'created_at',
      'id',
      'result',
      'state',
      'steps',
      'type',
      'updated_at',
    ]);
    expect(detailBody.updated_at).toBe(operation.updatedAt.toISOString());
    const original = await request(app.getHttpServer())
      .get(`${base}/${operation.id}/request`)
      .expect('Cache-Control', 'no-store')
      .expect(200);
    expect(original.body).toEqual(operation.request);
    const entries = await dataSource.getRepository(AuditLog).findBy({
      tenantId: tenantAId,
      operationId: operation.id,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorId: 'readonly-reader',
      actorType: AuditActorType.USER,
      action: AuditAction.READ,
      resourceType: 'operation_request',
      resourceId: operation.id,
    });
    expect(Object.keys(entries[0].metadata)).toEqual(['accessed_at']);
    const stored = await repository.findByIdForTenant(operation.id, tenantAId);
    expect(stored?.expiresAt.getTime()).toBe(
      stored!.viewedAt!.getTime() + 60 * 60 * 1000,
    );
    await request(app.getHttpServer()).get(`${base}/${foreign.id}`).expect(404);
    await request(app.getHttpServer())
      .get(`${base}/${foreign.id}/request`)
      .expect(404);
    expect(
      await dataSource.getRepository(AuditLog).countBy({
        tenantId: tenantBId,
        operationId: foreign.id,
      }),
    ).toBe(0);
  });

  it.each(['', '/request', '/items'])(
    'enforces the real tenant guard on cross-tenant operation reads%s',
    async (suffix) => {
      await request(app.getHttpServer())
        .get(
          `/api/v1/tenants/${tenantBId}/operations/${tenantAOperationId}${suffix}`,
        )
        .expect(403);
    },
  );

  it('enforces the real tenant guard on cross-tenant lists', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/tenants/${tenantBId}/operations`)
      .expect(403);
  });

  it('reads mixed-success settlement summaries and preserves failed batch totals after child purge', async () => {
    const parent = await repository.save(
      repository.create({
        tenantId: tenantAId,
        type: 'credential.offer-batch',
        state: OperationState.PROCESSING,
        request: { method: 'POST', path: '/test', body: {} },
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      }),
    );
    const children = await dataSource.getRepository(Operation).save(
      [
        OperationState.PENDING,
        OperationState.COMPLETED,
        OperationState.FAILED,
      ].map((state) =>
        repository.create({
          tenantId: tenantAId,
          batchId: parent.id,
          type: 'credential.offer',
          state,
          result:
            state === OperationState.FAILED
              ? { code: 'TEST_FAILURE', message: 'Test failure' }
              : null,
          request: { method: 'POST', path: '/test', body: {} },
          expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
        }),
      ),
    );
    const base = `/api/v1/tenants/${tenantAId}/operations/${parent.id}`;
    const processing = await request(app.getHttpServer()).get(base).expect(200);
    expect((processing.body as HttpOperation).result).toEqual({
      total: 3,
      pending: 1,
      processing: 0,
      completed: 1,
      failed: 1,
    });
    const items = await request(app.getHttpServer())
      .get(`${base}/items`)
      .query({ state: 'failed', limit: 1 })
      .expect(200);
    const itemsBody = items.body as HttpOperationPage;
    expect(itemsBody.data.map((item) => item.id)).toEqual([children[2].id]);
    expect(itemsBody.data[0].batch_id).toBe(parent.id);
    expect(itemsBody.data[0].result).toEqual({
      code: 'TEST_FAILURE',
      message: 'Test failure',
    });
    expect(itemsBody.pagination).toEqual({
      next_cursor: null,
      has_more: false,
    });
    await dataSource
      .getRepository(Operation)
      .update(
        { id: children[0].id, tenantId: tenantAId },
        { externalId: children[0].id },
      );
    await protocolStateChanges.process({
      tenantId: tenantAId,
      topic: 'issue_credential',
      externalId: children[0].id,
      protocolState: 'credential-issued',
      payload: { credential_exchange_id: children[0].id },
    });
    const settledCounts = {
      pending: 0,
      processing: 0,
      completed: 2,
      failed: 1,
    };
    expect(
      await repository.findByIdForTenant(parent.id, tenantAId),
    ).toMatchObject({
      state: OperationState.FAILED,
      result: settledCounts,
    });
    const failed = await request(app.getHttpServer()).get(base).expect(200);
    expect(failed.body).toMatchObject({ state: OperationState.FAILED });
    expect((failed.body as HttpOperation).result).toEqual({
      total: 3,
      completed: 2,
      failed: 1,
      errors: [
        { id: children[2].id, code: 'TEST_FAILURE', message: 'Test failure' },
      ],
    });
    const stored = await repository.findByIdForTenant(parent.id, tenantAId);
    expect(stored?.expiresAt.getTime()).toBe(
      stored!.viewedAt!.getTime() + 24 * 60 * 60 * 1000,
    );
    expect(stored?.result).toEqual(settledCounts);

    const operationRepo = dataSource.getRepository(Operation);
    await operationRepo.update(
      { tenantId: tenantAId, batchId: parent.id },
      { expiresAt: new Date(Date.now() - 1000) },
    );
    const purged = await operationRepo.delete({
      tenantId: tenantAId,
      batchId: parent.id,
      expiresAt: LessThan(new Date()),
    });
    expect(purged.affected).toBe(3);
    const afterPurge = await request(app.getHttpServer()).get(base).expect(200);
    expect(afterPurge.body).toMatchObject({ state: OperationState.FAILED });
    expect((afterPurge.body as HttpOperation).result).toEqual({
      total: 3,
      completed: 2,
      failed: 1,
      errors: [],
    });
    expect(
      (await repository.findByIdForTenant(parent.id, tenantAId))?.result,
    ).toEqual(settledCounts);
    await request(app.getHttpServer())
      .get(`${base}/items`)
      .set('Prefer', 'wait=30')
      .expect(200);
    await request(app.getHttpServer())
      .get(
        `/api/v1/tenants/${tenantAId}/operations/${tenantAOperationId}/items`,
      )
      .expect(404);
  });

  it('preserves ordinary parent-level batch failures through HTTP', async () => {
    const failure = {
      code: 'BATCH_UNAVAILABLE',
      message: 'Batch could not start',
    };
    const parent = await repository.save(
      repository.create({
        tenantId: tenantAId,
        type: 'credential.offer-batch',
        state: OperationState.FAILED,
        result: failure,
        request: { method: 'POST', path: '/test', body: {} },
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }),
    );
    const response = await request(app.getHttpServer())
      .get(`/api/v1/tenants/${tenantAId}/operations/${parent.id}`)
      .expect(200);
    expect(response.body).toMatchObject({
      state: OperationState.FAILED,
      result: failure,
    });
  });

  it('preserves settled batch totals after an expired child is purged', async () => {
    const settled = { pending: 0, processing: 0, completed: 2, failed: 0 };
    const parent = await repository.save(
      repository.create({
        tenantId: tenantAId,
        type: 'credential.offer-batch',
        state: OperationState.COMPLETED,
        result: settled,
        request: { method: 'POST', path: '/test', body: {} },
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      }),
    );
    const operationRepo = dataSource.getRepository(Operation);
    await operationRepo.save(
      [new Date(Date.now() - 1000), new Date(Date.now() + 60 * 60 * 1000)].map(
        (expiresAt) =>
          repository.create({
            tenantId: tenantAId,
            batchId: parent.id,
            type: 'credential.offer',
            state: OperationState.COMPLETED,
            request: { method: 'POST', path: '/test', body: {} },
            expiresAt,
          }),
      ),
    );
    const expected = { total: 2, completed: 2, failed: 0, errors: [] };
    expect((await service.getForTenant(tenantAId, parent.id)).result).toEqual(
      expected,
    );

    const deleted = await operationRepo.delete({
      tenantId: tenantAId,
      batchId: parent.id,
      expiresAt: LessThan(new Date()),
    });
    expect(deleted.affected).toBe(1);
    expect(
      await operationRepo.countBy({ tenantId: tenantAId, batchId: parent.id }),
    ).toBe(1);
    expect((await service.getForTenant(tenantAId, parent.id)).result).toEqual(
      expected,
    );
    expect(
      (await repository.findByIdForTenant(parent.id, tenantAId))?.result,
    ).toEqual(settled);
  });

  it.each([
    { createdAt: 'not-a-date', id: '123e4567-e89b-42d3-a456-426614174002' },
    {
      createdAt: '2025-02-30T00:00:00.000Z',
      id: '123e4567-e89b-42d3-a456-426614174002',
    },
    { createdAt: '2025-01-01T00:00:00.123456Z', id: 'not-a-uuid' },
  ])(
    'returns HTTP 400 for invalid decoded cursor values %j',
    async (cursor) => {
      const parent = await repository.save(
        repository.create({
          tenantId: tenantAId,
          type: 'credential.offer-batch',
          state: OperationState.PROCESSING,
          request: { method: 'POST', path: '/test', body: {} },
          expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
        }),
      );
      const base = `/api/v1/tenants/${tenantAId}/operations`;
      const encoded = encodeCursor(cursor);
      await request(app.getHttpServer())
        .get(base)
        .query({ cursor: encoded })
        .expect(400);
      await request(app.getHttpServer())
        .get(`${base}/${parent.id}/items`)
        .query({ cursor: encoded })
        .expect(400);
      await request(app.getHttpServer())
        .get(`${base}/${parent.id}/items`)
        .set('Prefer', 'wait=30')
        .query({ cursor: encoded })
        .expect(400);
    },
  );

  it('holds the status HTTP response until the operation changes and then applies first-view TTL', async () => {
    const operation = await repository.save(
      repository.create({
        tenantId: tenantAId,
        type: 'credential.offer',
        state: OperationState.PENDING,
        request: { method: 'POST', path: '/test', body: {} },
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      }),
    );
    let initialRead!: () => void;
    const started = new Promise<void>((resolve) => {
      initialRead = resolve;
    });
    const find = repository.findByIdForTenant.bind(repository);
    const lookup = jest
      .spyOn(repository, 'findByIdForTenant')
      .mockImplementationOnce(async (id, tenantId) => {
        const current = await find(id, tenantId);
        initialRead();
        return current;
      });
    let returned = false;
    const pending = request(app.getHttpServer())
      .get(`/api/v1/tenants/${tenantAId}/operations/${operation.id}`)
      .set('Prefer', 'wait=30')
      .expect(200)
      .then((response) => {
        returned = true;
        return response;
      });
    try {
      await started;
      expect(returned).toBe(false);
      expect((await find(operation.id, tenantAId))?.viewedAt).toBeNull();
      const result = { credential_exchange_id: 'status-exchange' };
      await dataSource
        .getRepository(Operation)
        .update(
          { id: operation.id, tenantId: tenantAId },
          { state: OperationState.COMPLETED, result },
        );
      const response = await pending;
      expect(response.body).toMatchObject({
        id: operation.id,
        state: 'completed',
        result,
      });
      expect(response.body).not.toHaveProperty('request');
      const stored = await find(operation.id, tenantAId);
      expect(stored?.viewedAt).toBeInstanceOf(Date);
      expect(stored?.expiresAt.getTime()).toBe(
        stored!.viewedAt!.getTime() + 60 * 60 * 1000,
      );
    } finally {
      lookup.mockRestore();
    }
  });

  it('returns the normal status envelope after a long-poll timeout without marking processing viewed', async () => {
    const operation = await repository.save(
      repository.create({
        tenantId: tenantAId,
        type: 'credential.offer',
        state: OperationState.PROCESSING,
        request: { method: 'POST', path: '/test', body: {} },
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      }),
    );
    const lookup = jest.spyOn(repository, 'findByIdForTenant');
    try {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/tenants/${tenantAId}/operations/${operation.id}`)
        .set('Prefer', 'wait=1')
        .expect(200);
      expect(response.body).toMatchObject({
        id: operation.id,
        state: 'processing',
        result: null,
      });
      expect(lookup.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(Object.keys(response.body as HttpOperation).sort()).toEqual([
        'batch_id',
        'created_at',
        'id',
        'result',
        'state',
        'steps',
        'type',
        'updated_at',
      ]);
      expect(
        (await repository.findByIdForTenant(operation.id, tenantAId))?.viewedAt,
      ).toBeNull();
    } finally {
      lookup.mockRestore();
    }
  });

  it('returns null for another tenant, indistinguishable from a missing row', async () => {
    const foreign = await repository.findByIdForTenant(
      tenantAOperationId,
      tenantBId,
    );
    const missing = await repository.findByIdForTenant(
      '123e4567-e89b-12d3-a456-426614174000',
      tenantBId,
    );

    expect(foreign).toBeNull();
    expect(missing).toBeNull();
  });
});
