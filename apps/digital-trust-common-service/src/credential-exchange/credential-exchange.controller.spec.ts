import {
  JwtGuard,
  ScopeAuthorizationService,
  ScopeGuard,
  TenantGuard,
} from '@app/auth';
import { RequestContextService } from '@app/common/context/request-context.service';
import { ExecutionContext, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { configureApp } from '../app.config';
import { API_BASE_PATH } from '../common/constants/api-version.constants';
import { Operation, OperationState } from '../operation/operation.entity';
import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import { CredentialExchangeController } from './credential-exchange.controller';
import { CredentialExchange } from './credential-exchange.entity';
import { CredentialExchangeService } from './credential-exchange.service';

describe('CredentialExchangeController', () => {
  let app: INestApplication<App>;
  const tenantId = '123e4567-e89b-42d3-a456-426614174001';
  const exchangeId = '123e4567-e89b-42d3-a456-426614174002';
  const base = `${API_BASE_PATH}/tenants/${tenantId}/credential-exchanges/${exchangeId}`;
  const get = jest.fn();
  const reconcile = jest.fn();
  const issue = jest.fn();
  const exchange = Object.assign(new CredentialExchange(), {
    id: exchangeId,
    tenantId,
    connectorId: 'private-connector',
    externalId: 'private-backend',
    role: 'issuer',
    protocol: 'didcomm-v1',
    format: 'anoncreds',
    state: 'request-received',
    connectionId: null,
    issueSubmission: 'not-submitted',
    issueOperationId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CredentialExchangeController],
      providers: [
        {
          provide: CredentialExchangeService,
          useValue: { get, reconcile, issue },
        },
        {
          provide: ConfigService,
          useValue: { get: (_key: string, fallback: unknown) => fallback },
        },
        RequestContextService,
        ScopeAuthorizationService,
        ScopeGuard,
      ],
    })
      .overrideGuard(JwtGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context
            .switchToHttp()
            .getRequest<{ headers: Record<string, string>; auth?: unknown }>();
          if (req.headers.authorization) {
            req.auth = {
              tenantId,
              roles: [],
              scopes: req.headers.authorization.split(' '),
            };
          }
          return true;
        },
      })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(TenantStatusGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(TenantTierRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    get.mockResolvedValue(exchange);
    reconcile.mockResolvedValue(exchange);
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves only the versioned route and serializes a public whitelist', async () => {
    const response = await request(app.getHttpServer())
      .get(base)
      .set('Authorization', 'credentials:offer')
      .expect(200);
    expect(response.body).toEqual({
      id: exchangeId,
      role: 'issuer',
      protocol: 'didcomm-v1',
      format: 'anoncreds',
      state: 'request-received',
      connection_id: null,
      issue_submission: 'not-submitted',
      issue_operation_id: null,
      created_at: exchange.createdAt.toISOString(),
      updated_at: exchange.updatedAt.toISOString(),
    });
    expect(get).toHaveBeenCalledWith(tenantId, exchangeId);
    await request(app.getHttpServer())
      .get(base.replace('/v1/', '/'))
      .set('Authorization', 'credentials:offer')
      .expect(404);
  });

  it('requires authentication and the exact scope', async () => {
    await request(app.getHttpServer()).get(base).expect(401);
    await request(app.getHttpServer())
      .post(`${base}/issue`)
      .set('Authorization', 'connections:manage')
      .expect(403);
    expect(issue).not.toHaveBeenCalled();
  });

  it('validates local UUIDs before service access', async () => {
    await request(app.getHttpServer())
      .get(base.replace(exchangeId, 'backend-id'))
      .set('Authorization', 'credentials:offer')
      .expect(400);
    expect(get).not.toHaveBeenCalled();
  });

  it('reconciles the existing resource with 200', async () => {
    await request(app.getHttpServer())
      .post(`${base}/reconcile`)
      .set('Authorization', 'credentials:offer')
      .expect(200);
    expect(reconcile).toHaveBeenCalledWith(tenantId, exchangeId);
    expect(issue).not.toHaveBeenCalled();
  });

  it('rejects undeclared action options instead of silently ignoring them', async () => {
    await request(app.getHttpServer())
      .post(`${base}/issue`)
      .set('Authorization', 'credentials:offer')
      .send({ options: { auto_issue: false } })
      .expect(400);
    await request(app.getHttpServer())
      .post(`${base}/reconcile`)
      .set('Authorization', 'credentials:offer')
      .send({ retry: true })
      .expect(400);
    expect(issue).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it.each([
    [OperationState.PENDING, 202],
    [OperationState.PROCESSING, 202],
    [OperationState.COMPLETED, 200],
    [OperationState.FAILED, 200],
  ])(
    'returns %s issue actions with HTTP %s and local references',
    async (state, status) => {
      issue.mockResolvedValue(
        Object.assign(new Operation(), {
          id: 'issue-operation',
          type: 'credential.issue',
          exchangeId,
          state,
          createdAt: new Date(),
          updatedAt: new Date(),
          result: null,
        }),
      );
      const response = await request(app.getHttpServer())
        .post(`${base}/issue`)
        .set('Authorization', 'credentials:offer')
        .expect(status);
      expect(response.body).toMatchObject({
        exchange_id: exchangeId,
        type: 'credential.issue',
        state,
      });
      expect(issue).toHaveBeenCalledWith(tenantId, exchangeId);
    },
  );
});
