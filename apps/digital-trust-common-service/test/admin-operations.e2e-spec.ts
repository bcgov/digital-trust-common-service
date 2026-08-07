import { JwtGuard, ScopeGuard } from '@app/auth';
import { PgBossService } from '@app/pg-boss';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';

import { configureApp } from '../src/app.config';
import { AppModule } from '../src/app.module';
import { API_BASE_PATH } from '../src/common/constants/api-version.constants';
import { Operation, OperationState } from '../src/operation/operation.entity';
import { Tenant } from '../src/tenant/tenant.entity';

class AllowGuard implements CanActivate {
  public canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}

describe('AdminOperationsController (e2e)', () => {
  let app: INestApplication<App>;
  let tenantRepo: Repository<Tenant>;
  let operationRepo: Repository<Operation>;

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
      .overrideGuard(JwtGuard)
      .useClass(AllowGuard)
      .overrideGuard(ScopeGuard)
      .useClass(AllowGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    tenantRepo = moduleFixture.get(getRepositoryToken(Tenant));
    operationRepo = moduleFixture.get(getRepositoryToken(Operation));
  });

  afterEach(async () => {
    await operationRepo.query('DELETE FROM operation');
    await tenantRepo.query('DELETE FROM tenant');
  });

  afterAll(async () => {
    await app.close();
  });

  async function createTenant(slug: string): Promise<Tenant> {
    const tenant = tenantRepo.create({
      name: `Admin Stats Tenant ${slug}`,
      slug,
      config: {},
    });

    return tenantRepo.save(tenant);
  }

  async function createOperation(
    tenant: Tenant,
    state: OperationState,
    createdAt: Date,
  ): Promise<Operation> {
    const operation = operationRepo.create({
      tenantId: tenant.id,
      type: 'credential.offer',
      state,
      request: { method: 'POST', path: '/x', body: {} },
      expiresAt: new Date(createdAt.getTime() + 72 * 60 * 60 * 1000),
    });
    const saved = await operationRepo.save(operation);

    await operationRepo.update(saved.id, { createdAt });

    return operationRepo.findOneByOrFail({ id: saved.id });
  }

  it('/admin/operations/stats (GET) returns zeroed stats when no operations exist', async () => {
    const response = await request(app.getHttpServer())
      .get(`${API_BASE_PATH}/admin/operations/stats`)
      .expect(200);

    expect(response.body).toEqual({
      countsByState: {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
      },
      totalCount: 0,
      oldestPendingCreatedAt: null,
    });
  });

  it('/admin/operations/stats (GET) aggregates counts by state and finds the oldest pending operation across tenants', async () => {
    const tenantA = await createTenant('admin-stats-tenant-a');
    const tenantB = await createTenant('admin-stats-tenant-b');

    const now = Date.now();
    const olderPendingCreatedAt = new Date(now - 60 * 60 * 1000);
    const newerPendingCreatedAt = new Date(now - 5 * 60 * 1000);

    await createOperation(
      tenantA,
      OperationState.PENDING,
      olderPendingCreatedAt,
    );
    await createOperation(
      tenantB,
      OperationState.PENDING,
      newerPendingCreatedAt,
    );
    await createOperation(tenantA, OperationState.PROCESSING, new Date(now));
    await createOperation(tenantB, OperationState.COMPLETED, new Date(now));
    await createOperation(tenantB, OperationState.COMPLETED, new Date(now));
    await createOperation(tenantA, OperationState.FAILED, new Date(now));

    const response = await request(app.getHttpServer())
      .get(`${API_BASE_PATH}/admin/operations/stats`)
      .expect(200);

    expect(response.body).toEqual({
      countsByState: {
        pending: 2,
        processing: 1,
        completed: 2,
        failed: 1,
      },
      totalCount: 6,
      oldestPendingCreatedAt: olderPendingCreatedAt.toISOString(),
    });
  });
});

describe('AdminOperationsController (e2e) — auth enforcement', () => {
  let app: INestApplication<App>;

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
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/admin/operations/stats (GET) returns 401 when no bearer token is provided', async () => {
    const response = await request(app.getHttpServer())
      .get(`${API_BASE_PATH}/admin/operations/stats`)
      .expect(401);

    expect(response.headers['www-authenticate']).toMatch(/Bearer error="/);
    expect(response.body).toMatchObject({
      error: { code: 'AUTHENTICATION_REQUIRED' },
    });
  });
});
