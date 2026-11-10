import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';

import { JwtGuard, TenantGuard } from '@app/auth';
import type { AuthContext } from '@app/auth';
import { RequestContextService } from '@app/common/context/request-context.service';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test, TestingModule } from '@nestjs/testing';
import { instanceToPlain } from 'class-transformer';
import type { Response } from 'express';
import request from 'supertest';

import { configureApp } from '../app.config';
import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import { OperationController } from './operation.controller';
import { Operation, OperationState } from './operation.entity';
import { OperationService } from './operation.service';

const requestActor = { sub: 'reader', tokenType: 'user' } as AuthContext;

class AllowGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest<{ auth: AuthContext }>().auth =
      requestActor;
    return true;
  }
}

describe('OperationController', () => {
  let controller: OperationController;
  let app: INestApplication<Server>;
  let mockGetForTenant: jest.Mock;
  let mockListForTenant: jest.Mock;
  let mockGetRequestForTenant: jest.Mock;
  let mockListItemsForTenant: jest.Mock;
  let mockWaitForItemsForTenant: jest.Mock;
  let mockWaitForStatusForTenant: jest.Mock;

  const tenantId = '123e4567-e89b-12d3-a456-426614174001';
  const operationId = '123e4567-e89b-12d3-a456-426614174000';
  const createdAt = new Date('2024-01-01T00:00:00.000Z');

  const buildOperation = (overrides: Partial<Operation> = {}): Operation =>
    ({
      id: operationId,
      tenantId,
      batchId: null,
      type: 'credential.offer',
      state: OperationState.PENDING,
      request: {
        method: 'POST',
        path: `/api/v1/tenants/${tenantId}/credentials/offer`,
        body: { given_name: 'Alice', birth_date: '1995-03-15' },
      },
      result: null,
      externalId: 'cred-exchange-123',
      viewedAt: null,
      expiresAt: new Date('2024-01-04T00:00:00.000Z'),
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    }) as Operation;

  beforeEach(async () => {
    mockGetForTenant = jest.fn();
    mockListForTenant = jest.fn();
    mockGetRequestForTenant = jest.fn();
    mockListItemsForTenant = jest.fn();
    mockWaitForItemsForTenant = jest.fn();
    mockWaitForStatusForTenant = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OperationController],
      providers: [
        ConfigService,
        RequestContextService,
        {
          provide: OperationService,
          useValue: {
            getForTenant: mockGetForTenant,
            listForTenant: mockListForTenant,
            getRequestForTenant: mockGetRequestForTenant,
            listItemsForTenant: mockListItemsForTenant,
            waitForItemsForTenant: mockWaitForItemsForTenant,
            waitForStatusForTenant: mockWaitForStatusForTenant,
          },
        },
      ],
    })
      .overrideGuard(JwtGuard)
      .useClass(AllowGuard)
      .overrideGuard(TenantGuard)
      .useClass(AllowGuard)
      .overrideGuard(TenantStatusGuard)
      .useClass(AllowGuard)
      .overrideGuard(TenantTierRateLimitGuard)
      .useClass(AllowGuard)
      .compile();

    controller = module.get(OperationController);
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('generates documented operation routes, examples, and query schemas', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    const base = '/api/v1/tenants/{tenantId}/operations';
    const detail = document.paths[`${base}/{operationId}`]?.get;

    expect(detail?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Prefer',
          in: 'header',
          required: false,
        }),
      ]),
    );
    expect(detail).toMatchObject({
      summary: 'Retrieve operation status and result',
      responses: {
        '200': {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/OperationResponseDto' },
              examples: {
                pending: { value: { state: 'pending', result: null } },
                failed: {
                  value: {
                    state: 'failed',
                    result: { code: 'ADAPTER_TIMEOUT' },
                  },
                },
                batchProcessing: {
                  value: { result: { total: 10, pending: 2 } },
                },
                batchCompleted: {
                  value: {
                    state: 'completed',
                    result: { total: 10, completed: 10, failed: 0, errors: [] },
                  },
                },
                batchFailed: {
                  value: {
                    state: 'failed',
                    result: {
                      total: 10,
                      completed: 9,
                      failed: 1,
                      errors: expect.any(Array),
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(document.paths[base]?.get?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'state', in: 'query' }),
        expect.objectContaining({ name: 'type', in: 'query' }),
        expect.objectContaining({ name: 'cursor', in: 'query' }),
        expect.objectContaining({
          name: 'limit',
          in: 'query',
          schema: expect.objectContaining({
            minimum: 1,
            maximum: 100,
            default: 20,
          }),
        }),
      ]),
    );
    expect(
      document.paths[`${base}/{operationId}/items`]?.get?.parameters,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Prefer',
          in: 'header',
          required: false,
        }),
      ]),
    );
    expect(document.paths[`${base}/{operationId}/request`]?.get).toMatchObject({
      description: expect.stringContaining('PII'),
      responses: {
        '200': {
          headers: { 'Cache-Control': { schema: { example: 'no-store' } } },
          content: {
            'application/json': {
              examples: {
                originalRequest: { value: { method: 'POST', body: {} } },
              },
            },
          },
        },
        '500': { description: expect.stringContaining('Audit write failed') },
      },
    });
  });

  it.each([
    ['wait=30', 30],
    ['wait=60', 30],
    ['return=minimal, wait="2"', 2],
  ])('long-polls operation status with Prefer: %s', async (prefer, seconds) => {
    mockWaitForStatusForTenant.mockResolvedValue(
      buildOperation({
        state: OperationState.COMPLETED,
        result: { credential_exchange_id: 'exchange' },
      }),
    );
    const response = await request(app.getHttpServer())
      .get(`/api/v1/tenants/${tenantId}/operations/${operationId}`)
      .set('Prefer', prefer)
      .expect(200);
    expect(mockWaitForStatusForTenant).toHaveBeenCalledWith(
      tenantId,
      operationId,
      seconds,
      expect.any(AbortSignal),
    );
    expect(mockGetForTenant).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({
      id: operationId,
      state: 'completed',
      result: { credential_exchange_id: 'exchange' },
    });
    expect(response.body).not.toHaveProperty('request');
  });

  it.each(['wait=0', 'return=minimal'])(
    'returns operation status immediately with Prefer: %s',
    async (prefer) => {
      mockGetForTenant.mockResolvedValue(buildOperation());
      await request(app.getHttpServer())
        .get(`/api/v1/tenants/${tenantId}/operations/${operationId}`)
        .set('Prefer', prefer)
        .expect(200);
      expect(mockGetForTenant).toHaveBeenCalledWith(tenantId, operationId);
      expect(mockWaitForStatusForTenant).not.toHaveBeenCalled();
    },
  );

  it.each(['wait', 'wait=-1', 'wait=1.5', 'wait=invalid', 'wait=1, wait=2'])(
    'rejects malformed status Prefer: %s',
    async (prefer) => {
      await request(app.getHttpServer())
        .get(`/api/v1/tenants/${tenantId}/operations/${operationId}`)
        .set('Prefer', prefer)
        .expect(400);
      expect(mockWaitForStatusForTenant).not.toHaveBeenCalled();
      expect(mockGetForTenant).not.toHaveBeenCalled();
    },
  );

  it('cancels the status wait and removes its response-close listener on disconnect', async () => {
    const response = new EventEmitter();
    mockWaitForStatusForTenant.mockImplementation(
      (_tenant, _id, _wait, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new Error('disconnected')),
            { once: true },
          );
        }),
    );
    const pending = controller.findById(
      tenantId,
      operationId,
      'wait=30',
      response as Response,
    );
    const assertion = expect(pending).rejects.toThrow('disconnected');
    response.emit('close');
    await assertion;
    expect(response.listenerCount('close')).toBe(0);
  });

  it('serves the versioned list route and transforms query parameters', async () => {
    mockListForTenant.mockResolvedValue({
      data: [buildOperation()],
      pagination: { next_cursor: null, has_more: false },
    });
    const response = await request(app.getHttpServer())
      .get(`/api/v1/tenants/${tenantId}/operations`)
      .query({ state: 'pending', type: 'credential.offer', limit: '20' })
      .expect(200);

    expect(mockListForTenant).toHaveBeenCalledWith(tenantId, {
      state: 'pending',
      type: 'credential.offer',
      limit: 20,
    });
    expect(response.body.pagination).toEqual({
      next_cursor: null,
      has_more: false,
    });
    expect(response.body.data[0].created_at).toBe(createdAt.toISOString());
    expect(response.body.data[0]).not.toHaveProperty('request');
  });

  it.each(['?state=invalid', '?limit=0', '?limit=101', '?unexpected=value'])(
    'rejects invalid HTTP list query %s before calling the service',
    async (query) => {
      await request(app.getHttpServer())
        .get(`/api/v1/tenants/${tenantId}/operations${query}`)
        .expect(400);
      expect(mockListForTenant).not.toHaveBeenCalled();
    },
  );

  it('serves the original request with no-store caching', async () => {
    mockGetRequestForTenant.mockResolvedValue(buildOperation().request);
    const response = await request(app.getHttpServer())
      .get(`/api/v1/tenants/${tenantId}/operations/${operationId}/request`)
      .expect('Cache-Control', 'no-store')
      .expect(200);
    expect(response.body).toEqual(buildOperation().request);
    expect(mockGetRequestForTenant).toHaveBeenCalledWith(
      tenantId,
      operationId,
      requestActor,
    );
  });

  it('serves the batch items route with state filtering', async () => {
    mockListItemsForTenant.mockResolvedValue({
      data: [],
      pagination: { next_cursor: null, has_more: false },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/tenants/${tenantId}/operations/${operationId}/items`)
      .query({ state: 'failed', limit: '20' })
      .expect(200);
    expect(mockListItemsForTenant).toHaveBeenCalledWith(tenantId, operationId, {
      state: 'failed',
      limit: 20,
    });
  });

  it('aborts long-polling and removes the close listener on disconnect', async () => {
    const response = new EventEmitter();
    mockWaitForItemsForTenant.mockImplementation(
      (_tenant, _id, _query, _wait, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new Error('disconnected')),
            { once: true },
          );
        }),
    );
    const pending = controller.findItems(
      tenantId,
      operationId,
      {},
      'wait=30',
      response as Response,
    );
    const assertion = expect(pending).rejects.toThrow('disconnected');
    response.emit('close');
    await assertion;
    expect(response.listenerCount('close')).toBe(0);
  });

  it('rejects type filtering on the batch items route', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/tenants/${tenantId}/operations/${operationId}/items`)
      .query({ type: 'credential.offer' })
      .expect(400);
    expect(mockListItemsForTenant).not.toHaveBeenCalled();
  });

  it.each([
    ['wait=30', 30],
    ['wait=60', 30],
    ['return=minimal, wait="2"', 2],
  ])('long-polls with Prefer: %s', async (prefer, seconds) => {
    mockWaitForItemsForTenant.mockResolvedValue({
      data: [],
      pagination: { next_cursor: null, has_more: false },
    });
    const response = await request(app.getHttpServer())
      .get(`/api/v1/tenants/${tenantId}/operations/${operationId}/items`)
      .set('Prefer', prefer)
      .expect(200);
    expect(mockWaitForItemsForTenant).toHaveBeenCalledWith(
      tenantId,
      operationId,
      {},
      seconds,
      expect.any(AbortSignal),
    );
    expect(mockListItemsForTenant).not.toHaveBeenCalled();
    expect(response.body).toEqual({
      data: [],
      pagination: { next_cursor: null, has_more: false },
    });
  });

  it.each(['wait=0', 'return=minimal'])(
    'does not long-poll with Prefer: %s',
    async (prefer) => {
      mockListItemsForTenant.mockResolvedValue({
        data: [],
        pagination: { next_cursor: null, has_more: false },
      });
      await request(app.getHttpServer())
        .get(`/api/v1/tenants/${tenantId}/operations/${operationId}/items`)
        .set('Prefer', prefer)
        .expect(200);
      expect(mockWaitForItemsForTenant).not.toHaveBeenCalled();
    },
  );

  it.each(['wait', 'wait=-1', 'wait=1.5', 'wait=invalid', 'wait=1, wait=2'])(
    'rejects malformed Prefer: %s',
    async (prefer) => {
      await request(app.getHttpServer())
        .get(`/api/v1/tenants/${tenantId}/operations/${operationId}/items`)
        .set('Prefer', prefer)
        .expect(400);
      expect(mockWaitForItemsForTenant).not.toHaveBeenCalled();
      expect(mockListItemsForTenant).not.toHaveBeenCalled();
    },
  );

  it.each(['request', 'items'])(
    'rejects invalid operation UUIDs on /%s',
    async (resource) => {
      await request(app.getHttpServer())
        .get(`/api/v1/tenants/${tenantId}/operations/invalid/${resource}`)
        .expect(400);
      expect(mockGetRequestForTenant).not.toHaveBeenCalled();
      expect(mockListItemsForTenant).not.toHaveBeenCalled();
    },
  );

  it('rejects an invalid tenant UUID before listing', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/tenants/invalid/operations')
      .expect(400);
    expect(mockListForTenant).not.toHaveBeenCalled();
  });

  it('lists filtered tenant operations without exposing stored requests', async () => {
    const query = {
      state: OperationState.PENDING,
      type: 'credential.offer',
      limit: 20,
    };
    mockListForTenant.mockResolvedValue({
      data: [buildOperation()],
      pagination: { next_cursor: 'cursor', has_more: true },
    });

    const response = instanceToPlain(
      await controller.findByTenantId(tenantId, query),
    );

    expect(mockListForTenant).toHaveBeenCalledWith(tenantId, query);
    expect(response.pagination).toEqual({
      next_cursor: 'cursor',
      has_more: true,
    });
    expect(response.data).toHaveLength(1);
    expect(response.data[0]).not.toHaveProperty('request');
    expect(response.data[0]).not.toHaveProperty('tenant_id');
  });

  it('returns an empty final list page', async () => {
    mockListForTenant.mockResolvedValue({
      data: [],
      pagination: { next_cursor: null, has_more: false },
    });
    expect(
      instanceToPlain(await controller.findByTenantId(tenantId, {})),
    ).toEqual({ data: [], pagination: { next_cursor: null, has_more: false } });
  });

  it('returns only the original request fields without redacting values', async () => {
    const request = buildOperation().request;
    mockGetRequestForTenant.mockResolvedValue({
      ...request,
      internal: 'hidden',
    });

    expect(
      await controller.findRequest(tenantId, operationId, requestActor),
    ).toEqual(request);
    expect(mockGetRequestForTenant).toHaveBeenCalledWith(
      tenantId,
      operationId,
      requestActor,
    );
  });

  it('lists filtered batch children using the shared operation envelope', async () => {
    const query = { state: OperationState.FAILED, cursor: 'cursor', limit: 20 };
    mockListItemsForTenant.mockResolvedValue({
      data: [
        buildOperation({ batchId: operationId, state: OperationState.FAILED }),
      ],
      pagination: { next_cursor: null, has_more: false },
    });
    const response = instanceToPlain(
      await controller.findItems(tenantId, operationId, query),
    );

    expect(mockListItemsForTenant).toHaveBeenCalledWith(
      tenantId,
      operationId,
      query,
    );
    expect(response.data[0].batch_id).toBe(operationId);
    expect(response.data[0]).not.toHaveProperty('request');
    expect(response.pagination).toEqual({ next_cursor: null, has_more: false });
  });

  it('propagates request lookup failures for missing or foreign operations', async () => {
    mockGetRequestForTenant.mockRejectedValue(new NotFoundException());
    await expect(
      controller.findRequest(tenantId, operationId, requestActor),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('propagates 404 when the requested operation is not a batch parent', async () => {
    mockListItemsForTenant.mockRejectedValue(new NotFoundException());
    await expect(
      controller.findItems(tenantId, operationId, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the pending envelope with a null result', async () => {
    mockGetForTenant.mockResolvedValue(buildOperation());

    await expect(controller.findById(tenantId, operationId)).resolves.toEqual({
      id: operationId,
      batchId: null,
      type: 'credential.offer',
      state: OperationState.PENDING,
      steps: [
        { type: 'credential-offer.send', state: 'pending' },
        { type: 'credential-request.receive', state: 'pending' },
        { type: 'credential.issue', state: 'pending' },
      ],
      createdAt,
      updatedAt: createdAt,
      result: null,
    });
    expect(mockGetForTenant).toHaveBeenCalledWith(tenantId, operationId);
  });

  it('returns the completed result and the parent batch id', async () => {
    const updatedAt = new Date('2024-01-01T00:00:05.000Z');
    mockGetForTenant.mockResolvedValue(
      buildOperation({
        state: OperationState.COMPLETED,
        batchId: '123e4567-e89b-12d3-a456-426614174009',
        result: { credential_exchange_id: 'exch-1' },
        updatedAt,
      }),
    );

    const response = await controller.findById(tenantId, operationId);

    expect(response.state).toBe(OperationState.COMPLETED);
    expect(response.batchId).toBe('123e4567-e89b-12d3-a456-426614174009');
    expect(response.result).toEqual({ credential_exchange_id: 'exch-1' });
    expect(response.updatedAt).toEqual(updatedAt);
  });

  it('returns the failure envelope for a failed operation', async () => {
    mockGetForTenant.mockResolvedValue(
      buildOperation({
        state: OperationState.FAILED,
        result: {
          code: 'ADAPTER_TIMEOUT',
          message: 'Traction did not respond within 30s',
        },
      }),
    );

    const response = await controller.findById(tenantId, operationId);

    expect(response.result).toEqual({
      code: 'ADAPTER_TIMEOUT',
      message: 'Traction did not respond within 30s',
    });
  });

  it('does not expose the request body or internal bookkeeping fields', async () => {
    mockGetForTenant.mockResolvedValue(buildOperation());

    const response = await controller.findById(tenantId, operationId);

    expect(Object.keys(response).sort()).toEqual([
      'batchId',
      'createdAt',
      'id',
      'result',
      'state',
      'steps',
      'type',
      'updatedAt',
    ]);
  });

  it('propagates the 404 for an unknown or cross-tenant operation', async () => {
    mockGetForTenant.mockRejectedValue(
      new NotFoundException('Operation not found'),
    );

    await expect(
      controller.findById(tenantId, operationId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
