import type { Server } from 'http';

import { JwtGuard, ScopeGuard, TenantGuard, type AuthContext } from '@app/auth';
import { RequestContextService } from '@app/common/context/request-context.service';
import { INestApplication, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApp } from '../app.config';
import { CredentialDefinitionFormat } from '../credential-definition/credential-definition.entity';
import { OperationState } from '../operation/operation.entity';
import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';
import { PresentationDefinitionController } from '../verification-profile/presentation-definition.controller';
import { VerificationProfileStatus } from '../verification-profile/verification-profile.entity';
import { VerificationProfileService } from '../verification-profile/verification-profile.service';

import { PresentationExecutionController } from './presentation-execution.controller';
import { PresentationRequestController } from './presentation-request.controller';
import { PresentationRequestService } from './presentation-request.service';

describe('Presentation resource HTTP contract', () => {
  let app: INestApplication;
  let server: Server;
  const tenantId = '123e4567-e89b-12d3-a456-426614174001';
  const id = '123e4567-e89b-12d3-a456-426614174003';
  const connectionId = '123e4567-e89b-12d3-a456-426614174002';
  const auth = {
    sub: 'user',
    tokenType: 'user',
    clientId: 'spa',
    tenantId,
    roles: [],
    scope: 'profiles:manage credentials:verify',
    scopes: ['profiles:manage', 'credentials:verify'],
    iss: 'https://issuer.example.test',
    aud: 'https://api.example.test',
    exp: 9999999999,
    iat: 1,
  } satisfies AuthContext;
  const body = {
    name: 'identity',
    version: '1.0',
    query: {
      type: 'dif-presentation-exchange',
      presentation_definition: {
        id: 'identity',
        input_descriptors: [
          {
            id: 'person',
            constraints: { fields: [{ path: ['$.credentialSubject.name'] }] },
          },
        ],
      },
    },
    options: { format: 'anoncreds' },
  };
  const profile = {
    id,
    tenantId,
    name: 'identity',
    version: '1.0',
    presentationDefinition: body.query.presentation_definition,
    presentationFormat: CredentialDefinitionFormat.ANONCREDS,
    status: VerificationProfileStatus.DRAFT,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const operation = {
    id,
    type: 'presentation_request',
    state: OperationState.PROCESSING,
    request: { body: { snapshot: {} } },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const profiles = {
    createDefinition: jest.fn().mockResolvedValue(profile),
    findDefinitions: jest.fn().mockResolvedValue({
      data: [profile],
      pagination: { has_more: false, next_cursor: null },
    }),
    findById: jest.fn().mockResolvedValue(profile),
    updateDefinition: jest.fn().mockResolvedValue(profile),
    publish: jest.fn().mockResolvedValue({
      ...profile,
      status: VerificationProfileStatus.PUBLISHED,
    }),
    deprecate: jest.fn().mockResolvedValue({
      ...profile,
      status: VerificationProfileStatus.DEPRECATED,
    }),
  };
  const executions = {
    create: jest.fn().mockResolvedValue(operation),
    get: jest.fn().mockResolvedValue(operation),
    requestPresentation: jest.fn().mockResolvedValue(operation),
  };

  beforeAll(async () => {
    const builder = Test.createTestingModule({
      controllers: [
        PresentationDefinitionController,
        PresentationExecutionController,
        PresentationRequestController,
      ],
      providers: [
        { provide: VerificationProfileService, useValue: profiles },
        { provide: PresentationRequestService, useValue: executions },
        { provide: ConfigService, useValue: new ConfigService() },
        RequestContextService,
      ],
    });
    for (const guard of [
      JwtGuard,
      ScopeGuard,
      TenantGuard,
      TenantStatusGuard,
      TenantTierRateLimitGuard,
    ]) {
      builder.overrideGuard(guard).useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest<{ auth: AuthContext }>().auth =
            auth;
          return true;
        },
      });
    }
    const module = await builder.compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer<Server>();
  });
  afterAll(async () => app.close());

  it('creates/reads/lists definitions using snake-case wire fields', async () => {
    const response = await request(server)
      .post(`/api/v1/tenants/${tenantId}/presentation-definitions`)
      .send(body)
      .expect(201);
    expect(response.body.query.presentation_definition).toEqual(
      body.query.presentation_definition,
    );
    expect(response.body.query).not.toHaveProperty('presentationDefinition');
    expect(response.body.tenant_id).toBe(tenantId);
    await request(server)
      .get(`/api/v1/tenants/${tenantId}/presentation-definitions/${id}`)
      .expect(200);
    const list = await request(server)
      .get(`/api/v1/tenants/${tenantId}/presentation-definitions?limit=1`)
      .expect(200);
    expect(list.body.data[0].id).toBe(id);
    expect(profiles.createDefinition).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        query: expect.objectContaining({
          presentationDefinition: body.query.presentation_definition,
        }),
      }),
      auth,
    );
  });

  it('wires draft updates and explicit lifecycle routes', async () => {
    await request(server)
      .patch(`/api/v1/tenants/${tenantId}/presentation-definitions/${id}`)
      .send({ description: 'updated' })
      .expect(200);
    expect(profiles.updateDefinition).toHaveBeenCalledWith(
      tenantId,
      id,
      expect.objectContaining({ description: 'updated' }),
      auth,
    );
    await request(server)
      .post(
        `/api/v1/tenants/${tenantId}/presentation-definitions/${id}/publish`,
      )
      .expect(200);
    await request(server)
      .post(
        `/api/v1/tenants/${tenantId}/presentation-definitions/${id}/deprecate`,
      )
      .expect(200);
    expect(profiles.publish).toHaveBeenCalledWith(tenantId, id, auth);
    expect(profiles.deprecate).toHaveBeenCalledWith(tenantId, id, auth);
  });

  it('creates/reads executions without exposing internal snapshots', async () => {
    const response = await request(server)
      .post(`/api/v1/tenants/${tenantId}/presentation-requests`)
      .send({
        presentation_definition_id: id,
        delivery: { connection_id: connectionId },
      })
      .expect(202);
    expect(response.body.id).toBe(id);
    expect(response.body).not.toHaveProperty('request');
    expect(executions.create).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({
        presentationDefinitionId: id,
        delivery: expect.objectContaining({ connectionId }),
      }),
      auth,
    );
    await request(server)
      .get(`/api/v1/tenants/${tenantId}/presentation-requests/${id}`)
      .expect(200);
    expect(executions.get).toHaveBeenCalledWith(tenantId, id, auth);
  });

  it('keeps the existing presentation submission route', async () => {
    await request(server)
      .post(`/api/v1/tenants/${tenantId}/presentations/request`)
      .send({ verification_profile_id: id, connection_id: connectionId })
      .expect(202);
    expect(executions.requestPresentation).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ verificationProfileId: id, connectionId }),
    );
  });

  it('returns synchronous submission failures as a terminal operation envelope', async () => {
    executions.create.mockResolvedValueOnce({
      ...operation,
      state: OperationState.FAILED,
    });
    const response = await request(server)
      .post(`/api/v1/tenants/${tenantId}/presentation-requests`)
      .send({
        presentation_definition_id: id,
        delivery: { connection_id: connectionId },
      })
      .expect(200);
    expect(response.body.state).toBe('failed');
  });

  it('rejects unknown query/delivery fields and unversioned routes', async () => {
    await request(server)
      .post(`/api/v1/tenants/${tenantId}/presentation-definitions`)
      .send({ ...body, query: { ...body.query, dcql: {} } })
      .expect(400);
    await request(server)
      .post(`/api/v1/tenants/${tenantId}/presentation-requests`)
      .send({
        presentation_definition_id: id,
        delivery: { connection_id: connectionId, nonce: '123' },
      })
      .expect(400);
    await request(server)
      .get(`/api/tenants/${tenantId}/presentation-definitions`)
      .expect(404);
  });
});
