import { PgBossService } from '@app/pg-boss';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';

import { AppModule } from '../src/app.module';
import { OperationPurgeService } from '../src/operation/operation-purge.service';
import { Operation, OperationState } from '../src/operation/operation.entity';
import { OperationService } from '../src/operation/operation.service';
import { Tenant } from '../src/tenant/tenant.entity';

describe('Operation TTL & purge (e2e)', () => {
  let app: INestApplication<App>;
  let tenantRepo: Repository<Tenant>;
  let operationRepo: Repository<Operation>;
  let operationService: OperationService;
  let purgeService: OperationPurgeService;

  const mockBoss = {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
    createQueue: jest.fn().mockResolvedValue(undefined),
    schedule: jest.fn().mockResolvedValue(undefined),
    work: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PgBossService)
      .useValue({
        boss: mockBoss,
        initializeBoss: jest.fn().mockResolvedValue(mockBoss),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    tenantRepo = moduleFixture.get(getRepositoryToken(Tenant));
    operationRepo = moduleFixture.get(getRepositoryToken(Operation));
    operationService = moduleFixture.get(OperationService);
    purgeService = moduleFixture.get(OperationPurgeService);
  });

  afterEach(async () => {
    await operationRepo.query('DELETE FROM operation');
    await tenantRepo.query('DELETE FROM tenant');
  });

  afterAll(async () => {
    await app.close();
  });

  async function createTenant(
    slug: string,
    config: Record<string, unknown> = {},
  ): Promise<Tenant> {
    const tenant = tenantRepo.create({
      name: `Operation TTL Tenant ${slug}`,
      slug,
      config,
    });

    return tenantRepo.save(tenant);
  }

  it('applies the system-default 72h TTL on creation when the tenant has no override', async () => {
    const tenant = await createTenant('ttl-default');

    const before = Date.now();
    const operation = await operationService.createOperation({
      tenantId: tenant.id,
      type: 'credential.offer',
      request: { method: 'POST', path: '/x', body: {} },
    });
    const after = Date.now();

    const expectedMinMs = 72 * 60 * 60 * 1000;
    const actualMs =
      operation.expiresAt.getTime() - operation.createdAt.getTime();

    expect(operation.state).toBe(OperationState.PENDING);
    expect(actualMs).toBeGreaterThanOrEqual(expectedMinMs - 1000);
    expect(actualMs).toBeLessThanOrEqual(
      expectedMinMs + (after - before) + 1000,
    );
  });

  it('honors a per-tenant operation_ttl.completed_unviewed override', async () => {
    const tenant = await createTenant('ttl-override', {
      operation_ttl: { completed_unviewed: '2h' },
    });

    const operation = await operationService.createOperation({
      tenantId: tenant.id,
      type: 'credential.offer',
      request: { method: 'POST', path: '/x', body: {} },
    });

    const completed = await operationService.transitionState(
      operation.id,
      OperationState.COMPLETED,
      { credentialExchangeId: 'abc' },
    );

    const actualMs =
      completed.expiresAt.getTime() - completed.createdAt.getTime();
    const expectedMs = 2 * 60 * 60 * 1000;

    expect(completed.state).toBe(OperationState.COMPLETED);
    expect(actualMs).toBeGreaterThanOrEqual(expectedMs - 1000);
    expect(actualMs).toBeLessThanOrEqual(expectedMs + 1000);
  });

  it('shortens the TTL once an operation is marked viewed, per tenant override', async () => {
    const tenant = await createTenant('ttl-viewed', {
      operation_ttl: { completed_viewed: '15m' },
    });

    const operation = await operationService.createOperation({
      tenantId: tenant.id,
      type: 'credential.offer',
      request: { method: 'POST', path: '/x', body: {} },
    });

    await operationService.transitionState(
      operation.id,
      OperationState.COMPLETED,
      {
        credentialExchangeId: 'abc',
      },
    );

    const viewed = await operationService.markViewed(operation.id);

    const actualMs =
      viewed.expiresAt.getTime() - (viewed.viewedAt as Date).getTime();
    const expectedMs = 15 * 60 * 1000;

    expect(viewed.viewedAt).not.toBeNull();
    expect(actualMs).toBeGreaterThanOrEqual(expectedMs - 1000);
    expect(actualMs).toBeLessThanOrEqual(expectedMs + 1000);
  });

  it('honors a per-tenant operation_ttl.failed_unviewed override', async () => {
    const tenant = await createTenant('ttl-failed-unviewed', {
      operation_ttl: { failed_unviewed: '3d' },
    });

    const operation = await operationService.createOperation({
      tenantId: tenant.id,
      type: 'credential.offer',
      request: { method: 'POST', path: '/x', body: {} },
    });

    const failed = await operationService.transitionState(
      operation.id,
      OperationState.FAILED,
      { code: 'issuer_unavailable', message: 'Traction returned 503' },
    );

    const actualMs = failed.expiresAt.getTime() - failed.createdAt.getTime();
    const expectedMs = 3 * 24 * 60 * 60 * 1000;

    expect(failed.state).toBe(OperationState.FAILED);
    expect(actualMs).toBeGreaterThanOrEqual(expectedMs - 1000);
    expect(actualMs).toBeLessThanOrEqual(expectedMs + 1000);
  });

  it('honors a per-tenant operation_ttl.failed_viewed override once marked viewed', async () => {
    const tenant = await createTenant('ttl-failed-viewed', {
      operation_ttl: { failed_viewed: '2h' },
    });

    const operation = await operationService.createOperation({
      tenantId: tenant.id,
      type: 'credential.offer',
      request: { method: 'POST', path: '/x', body: {} },
    });

    await operationService.transitionState(
      operation.id,
      OperationState.FAILED,
      {
        code: 'issuer_unavailable',
        message: 'Traction returned 503',
      },
    );

    const viewed = await operationService.markViewed(operation.id);

    const actualMs =
      viewed.expiresAt.getTime() - (viewed.viewedAt as Date).getTime();
    const expectedMs = 2 * 60 * 60 * 1000;

    expect(viewed.state).toBe(OperationState.FAILED);
    expect(actualMs).toBeGreaterThanOrEqual(expectedMs - 1000);
    expect(actualMs).toBeLessThanOrEqual(expectedMs + 1000);
  });

  it('honors a per-tenant operation_ttl.pending_stale override while pending', async () => {
    const tenant = await createTenant('ttl-pending-stale', {
      operation_ttl: { pending_stale: '4h' },
    });

    const operation = await operationService.createOperation({
      tenantId: tenant.id,
      type: 'credential.offer',
      request: { method: 'POST', path: '/x', body: {} },
    });

    // transitionState() recomputes expiresAt via computeExpiresAt() for the
    // *current* state, so re-asserting PENDING exercises the pending_stale
    // branch (creation always uses the create-time default; PE-08's stale
    // sweep is what would apply this override to a still-pending operation).
    const pending = await operationService.transitionState(
      operation.id,
      OperationState.PENDING,
    );

    const actualMs = pending.expiresAt.getTime() - pending.createdAt.getTime();
    const expectedMs = 4 * 60 * 60 * 1000;

    expect(pending.state).toBe(OperationState.PENDING);
    expect(actualMs).toBeGreaterThanOrEqual(expectedMs - 1000);
    expect(actualMs).toBeLessThanOrEqual(expectedMs + 1000);
  });

  it('falls back to the system default when a tenant override is malformed', async () => {
    const tenant = await createTenant('ttl-invalid-override', {
      operation_ttl: { completed_unviewed: 'not-a-duration' },
    });

    const operation = await operationService.createOperation({
      tenantId: tenant.id,
      type: 'credential.offer',
      request: { method: 'POST', path: '/x', body: {} },
    });

    const completed = await operationService.transitionState(
      operation.id,
      OperationState.COMPLETED,
      { credentialExchangeId: 'abc' },
    );

    const actualMs =
      completed.expiresAt.getTime() - completed.createdAt.getTime();
    const expectedMs = 72 * 60 * 60 * 1000; // system default, override ignored

    expect(actualMs).toBeGreaterThanOrEqual(expectedMs - 1000);
    expect(actualMs).toBeLessThanOrEqual(expectedMs + 1000);
  });

  it('purges only expired operations and preserves unexpired ones, across tenants', async () => {
    const tenantA = await createTenant('purge-tenant-a');
    const tenantB = await createTenant('purge-tenant-b');

    const expiredA1 = await operationService.createOperation({
      tenantId: tenantA.id,
      type: 'credential.offer',
      request: { method: 'POST', path: '/x', body: {} },
    });
    const expiredA2 = await operationService.createOperation({
      tenantId: tenantA.id,
      type: 'credential.offer',
      request: { method: 'POST', path: '/x', body: {} },
    });
    const expiredB1 = await operationService.createOperation({
      tenantId: tenantB.id,
      type: 'credential.offer',
      request: { method: 'POST', path: '/x', body: {} },
    });
    const notExpired = await operationService.createOperation({
      tenantId: tenantA.id,
      type: 'credential.offer',
      request: { method: 'POST', path: '/x', body: {} },
    });

    // Force three operations into the past so they are already expired,
    // leaving the fourth with its natural future expiry.
    const alreadyExpired = new Date(Date.now() - 60 * 1000);
    await operationRepo.update(expiredA1.id, { expiresAt: alreadyExpired });
    await operationRepo.update(expiredA2.id, { expiresAt: alreadyExpired });
    await operationRepo.update(expiredB1.id, { expiresAt: alreadyExpired });

    await purgeService.purgeExpiredOperations();

    const remainingIds = (await operationRepo.find()).map((op) => op.id);

    expect(remainingIds).toEqual([notExpired.id]);
    expect(remainingIds).not.toContain(expiredA1.id);
    expect(remainingIds).not.toContain(expiredA2.id);
    expect(remainingIds).not.toContain(expiredB1.id);
  });
});
