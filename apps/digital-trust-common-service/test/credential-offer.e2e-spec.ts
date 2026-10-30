import { randomBytes } from 'crypto';

import { JwtGuard, TENANT_SUPERUSER_SCOPE } from '@app/auth';
import { PgBossService } from '@app/pg-boss';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';

import { AdapterRegistry } from '../src/adapter-registry/adapter-registry.service';
import { configureApp } from '../src/app.config';
import { AppModule } from '../src/app.module';
import { API_BASE_PATH } from '../src/common/constants/api-version.constants';
import { EncryptionService } from '../src/common/crypto/encryption.service';
import {
  Connection,
  ConnectionProtocol,
  ConnectionState,
  ConnectorType,
} from '../src/connection/connection.entity';
import { ConnectionService } from '../src/connection/connection.service';
import { ConnectorCredential } from '../src/connector-credential/connector-credential.entity';
import { Credential } from '../src/credential/credential.entity';
import {
  CredentialDefinition,
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
} from '../src/credential-definition/credential-definition.entity';
import { JobsService } from '../src/jobs/jobs.service';
import { OPERATION_TYPE } from '../src/operation/operation-type.constants';
import { Operation, OperationState } from '../src/operation/operation.entity';
import { ProtocolStateChangeService } from '../src/protocol-state-change/protocol-state-change.service';
import { Tenant } from '../src/tenant/tenant.entity';
import { TractionHttpClient } from '../src/traction/traction-http-client.service';
import { TractionTokenManager } from '../src/traction/traction-token-manager.service';
import { TractionAdapter } from '../src/traction/traction.adapter';

const mockBoss = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  send: jest
    .fn<Promise<void>, [string, { event?: string }]>()
    .mockResolvedValue(undefined),
  createQueue: jest.fn().mockResolvedValue(undefined),
  schedule: jest.fn().mockResolvedValue(undefined),
  work: jest.fn().mockResolvedValue(undefined),
};

/**
 * Stands in for JwtGuard so the request carries a real, tenant-scoped auth
 * context with the credentials:offer scope, same pattern as
 * product-controller-auth.e2e-spec.ts's TenantAuthStubGuard.
 */
class OfferAuthStubGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    const httpRequest = context
      .switchToHttp()
      .getRequest<{ auth?: unknown; params?: Record<string, string> }>();

    httpRequest.auth = {
      sub: 'credential-offer-e2e-sub',
      tokenType: 'user',
      roles: [],
      scopes: ['credentials:offer', TENANT_SUPERUSER_SCOPE],
      tenantId: httpRequest.params?.tenantId ?? null,
    };

    return true;
  }
}

/**
 * Boots the real AppModule (real DI graph, real ConfigService, real
 * database rows) and exercises POST /credentials/offer end-to-end. This is
 * the layer that would have caught IssuerPort/AdapterRegistry only being
 * wired to a fail-closed StubAdapter with nothing registered for any real
 * connector type yet (see adapter-registry.e2e-spec.ts's "should leave the
 * fail-closed StubAdapter port bindings intact" and "should start with no
 * adapters registered" assertions) — a unit spec that mocks AdapterRegistry
 * cannot see that gap, since it never exercises the real registry.
 */
describe('Credential offer (e2e)', () => {
  let app: INestApplication<App>;
  let tenantRepo: Repository<Tenant>;
  let credentialDefinitionRepo: Repository<CredentialDefinition>;
  let operationRepo: Repository<Operation>;
  let credentialRepo: Repository<Credential>;
  let registry: AdapterRegistry;
  let tenant: Tenant;
  let credentialDefinition: CredentialDefinition;
  let connectorRepo: Repository<ConnectorCredential>;
  let connectionRepo: Repository<Connection>;
  let connection: Connection;
  let traction: TractionAdapter;
  let encryption: EncryptionService;
  const backendRequest = jest.fn<
    Promise<{ data: unknown }>,
    [
      { url: string; method: string; params?: Record<string, unknown> },
      boolean?,
    ]
  >();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PgBossService)
      .useValue({
        boss: mockBoss,
        initializeBoss: jest.fn().mockResolvedValue(mockBoss),
        stop: jest.fn().mockResolvedValue(undefined),
        isRunning: jest.fn().mockReturnValue(true),
      })
      .overrideGuard(JwtGuard)
      .useClass(OfferAuthStubGuard)
      .overrideProvider(TractionHttpClient)
      .useValue({ request: backendRequest })
      .overrideProvider(TractionTokenManager)
      .useValue({
        getToken: jest.fn().mockResolvedValue(randomBytes(16).toString('hex')),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    tenantRepo = moduleFixture.get(getRepositoryToken(Tenant));
    credentialDefinitionRepo = moduleFixture.get(
      getRepositoryToken(CredentialDefinition),
    );
    operationRepo = moduleFixture.get(getRepositoryToken(Operation));
    credentialRepo = moduleFixture.get(getRepositoryToken(Credential));
    registry = moduleFixture.get(AdapterRegistry);
    connectorRepo = moduleFixture.get(getRepositoryToken(ConnectorCredential));
    connectionRepo = moduleFixture.get(getRepositoryToken(Connection));
    traction = moduleFixture.get(TractionAdapter);
    encryption = moduleFixture.get(EncryptionService);
  });

  beforeEach(async () => {
    // Confirms the real application graph, not just this suite, starts with
    // no adapter registered — the same fail-closed state
    // adapter-registry.e2e-spec.ts asserts against AppModule directly.
    registry.reset();
    backendRequest.mockReset();
    mockBoss.send.mockClear();

    tenant = await tenantRepo.save(
      tenantRepo.create({
        name: 'Credential Offer E2E Tenant',
        slug: `credential-offer-e2e-${Date.now()}`,
        config: {},
      }),
    );

    const encrypted = encryption.encrypt({});
    const connector = await connectorRepo.save({
      tenantId: tenant.id,
      connectorType: ConnectorType.TRACTION,
      endpointUrl: 'https://agent.example.test',
      credentialsEncrypted: encrypted.ciphertext,
      keyVersion: encrypted.keyVersion,
      active: true,
    });
    credentialDefinition = await credentialDefinitionRepo.save(
      credentialDefinitionRepo.create({
        tenantId: tenant.id,
        name: 'Diploma',
        format: CredentialDefinitionFormat.ANONCREDS,
        options: {
          format: CredentialDefinitionFormat.ANONCREDS,
          tag: 'default',
          status: { revocation: { enabled: true } },
        },
        schemaDefinition: { attr_names: ['given_name'] },
        externalId: 'cred-def-external-e2e',
        connectorType: CredentialDefinitionConnectorType.TRACTION,
        connectorId: connector.id,
        registrationState: 'ready',
        isActive: true,
      }),
    );
    connection = await connectionRepo.save({
      tenantId: tenant.id,
      connectorId: connector.id,
      connectorType: ConnectorType.TRACTION,
      protocol: ConnectionProtocol.DIDCOMM_V1,
      state: ConnectionState.ACTIVE,
      externalConnectionId: `holder-${tenant.id}`,
      metadata: {},
    });
  });

  afterEach(async () => {
    await credentialRepo.query('DELETE FROM credential WHERE tenant_id = $1', [
      tenant.id,
    ]);
    await operationRepo.query('DELETE FROM operation WHERE tenant_id = $1', [
      tenant.id,
    ]);
    await credentialDefinitionRepo.delete(credentialDefinition.id);
    await connectionRepo.delete({ tenantId: tenant.id });
    await connectorRepo.delete({ tenantId: tenant.id });
    await tenantRepo.delete(tenant.id);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 400 (not 500, not a silent success) when no adapter is registered for the resolved format', async () => {
    const response = await request(app.getHttpServer())
      .post(`${API_BASE_PATH}/tenants/${tenant.id}/credentials/offer`)
      .send({
        credential_definition_id: credentialDefinition.id,
        delivery: {
          protocol: 'didcomm-v1',
          connection_id: '123e4567-e89b-12d3-a456-426614174099',
        },
        credential: { credentialSubject: { given_name: 'Alice' } },
      })
      .expect(400);

    expect(response.body).toMatchObject({ error: { code: 'BAD_REQUEST' } });

    // The adapter pre-flight resolve happens before any DB writes, so a
    // connector-configuration problem must not leave a stillborn
    // Operation/Credential pair behind.
    const operations = await operationRepo.find({
      where: { tenantId: tenant.id },
    });
    const credentials = await credentialRepo.find({
      where: { tenantId: tenant.id },
    });
    expect(operations).toHaveLength(0);
    expect(credentials).toHaveLength(0);
  });

  const offerBody = () => ({
    credential_definition_id: credentialDefinition.id,
    delivery: {
      protocol: 'didcomm-v1',
      connection_id: connection.id,
    },
    credential: { credentialSubject: { given_name: 'Alice' } },
    options: { auto_issue: false },
  });

  const prepareBackend = (state = 'credential_issued') => {
    traction.onModuleInit();
    backendRequest.mockImplementation((config: { url: string }) => {
      if (config.url.endsWith('/connections')) {
        return Promise.resolve({
          data: {
            results: [
              {
                connection_id: connection.externalConnectionId,
                invitation_msg_id: `invitation-${tenant.id}`,
                state: 'completed',
              },
            ],
          },
        });
      }
      if (config.url.includes('/connections/')) {
        return Promise.resolve({
          data: {
            connection_id: connection.externalConnectionId,
            state: 'active',
            connection_protocol: 'didexchange/1.0',
          },
        });
      }
      const record = {
        cred_ex_id: `exchange-${tenant.id}`,
        connection_id: connection.externalConnectionId,
        state: config.url.endsWith('/send-offer') ? 'offer_sent' : state,
      };
      return Promise.resolve({
        data: config.url.endsWith('/send-offer')
          ? record
          : { cred_ex_record: record },
      });
    });
  };

  it('sends once through the real adapter and reconciles monotonically without duplicate notifications', async () => {
    prepareBackend();
    const offered = await request(app.getHttpServer())
      .post(`${API_BASE_PATH}/tenants/${tenant.id}/credentials/offer`)
      .send(offerBody())
      .expect(202);
    const operationId = (offered.body as { id: string }).id;
    expect(operationId).toEqual(expect.any(String));
    expect(offered.body).not.toHaveProperty('exchange_id');
    const sent = backendRequest.mock.calls.find(
      ([config]) => config.method === 'POST',
    );
    expect(sent?.[0]).toMatchObject({
      method: 'POST',
      data: {
        connection_id: connection.externalConnectionId,
        auto_issue: false,
        auto_remove: false,
        auto_remove_on_failure: false,
        filter: { anoncreds: { cred_def_id: 'cred-def-external-e2e' } },
        credential_preview: {
          attributes: [{ name: 'given_name', value: 'Alice' }],
        },
      },
    });
    expect(sent?.[1]).toBe(false);
    const [savedCredential] = await credentialRepo.find({
      where: { tenantId: tenant.id },
    });
    expect(savedCredential).toMatchObject({
      operationId,
      connectionId: connection.id,
      connectorId: connection.connectorId,
      externalId: `exchange-${tenant.id}`,
      state: 'offered',
    });
    mockBoss.send.mockClear();
    for (let i = 0; i < 2; i++) {
      const reconciled = await request(app.getHttpServer())
        .post(
          `${API_BASE_PATH}/tenants/${tenant.id}/credentials/offer/${operationId}/reconcile`,
        )
        .expect(200);
      expect(reconciled.body).toMatchObject({
        id: operationId,
        state: 'completed',
      });
    }
    expect(
      backendRequest.mock.calls.filter(
        ([config]: [{ method: string }]) => config.method === 'POST',
      ),
    ).toHaveLength(1);
    expect(
      mockBoss.send.mock.calls.filter(
        ([queue]) => queue === 'webhook.dispatch',
      ),
    ).toHaveLength(1);
    const issued = await credentialRepo.findOneByOrFail({
      id: savedCredential.id,
    });
    expect(issued.state).toBe('issued');
    expect(issued.issuedAt).toBeInstanceOf(Date);
  });

  it('rejects a connection outside the tenant before submitting an offer', async () => {
    prepareBackend();
    const otherTenant = await tenantRepo.save({
      name: 'Other offer tenant',
      slug: `other-offer-${tenant.id}`,
      config: {},
    });
    try {
      await connectionRepo.update(connection.id, { tenantId: otherTenant.id });
      await request(app.getHttpServer())
        .post(`${API_BASE_PATH}/tenants/${tenant.id}/credentials/offer`)
        .send(offerBody())
        .expect(404);
      expect(backendRequest).not.toHaveBeenCalled();
      expect(await operationRepo.countBy({ tenantId: tenant.id })).toBe(0);
    } finally {
      await connectionRepo.update(connection.id, { tenantId: tenant.id });
      await tenantRepo.delete(otherTenant.id);
    }
  });

  it.each(['reconcile-first', 'webhook-first', 'race', 'completed-first'])(
    'notifies establishment exactly once across %s arrival',
    async (order) => {
      prepareBackend();
      await connectionRepo.update(connection.id, {
        state: ConnectionState.INVITED,
        connectorId: null,
        metadata: { invitationId: `invitation-${tenant.id}` },
      });
      await operationRepo.save({
        tenantId: tenant.id,
        type: OPERATION_TYPE.CONNECTION_CREATE,
        state: OperationState.PROCESSING,
        externalId: connection.externalConnectionId,
        request: { method: 'POST', path: '/connections', body: {} },
        expiresAt: new Date(Date.now() + 60000),
      });
      const emit = jest.spyOn(app.get(EventEmitter2), 'emit');
      const reconcile = () =>
        app
          .get(ConnectionService)
          .resolveForIssuance(
            tenant.id,
            connection.id,
            connection.connectorId!,
          );
      const webhook = () =>
        app.get(ProtocolStateChangeService).process({
          tenantId: tenant.id,
          topic: 'connections',
          externalId: connection.externalConnectionId!,
          protocolState: order === 'completed-first' ? 'completed' : 'active',
          payload: { invitation_msg_id: `invitation-${tenant.id}` },
        });
      try {
        if (order === 'race') await Promise.all([reconcile(), webhook()]);
        else if (order === 'reconcile-first') {
          await reconcile();
          await webhook();
        } else {
          await webhook();
          await reconcile();
        }
        await webhook();
        await reconcile();
        expect(
          mockBoss.send.mock.calls.filter(
            ([queue, payload]) =>
              queue === 'webhook.dispatch' &&
              payload.event === 'connection.established',
          ),
        ).toHaveLength(1);
        expect(
          emit.mock.calls.filter(
            ([event]) => event === 'connection.established',
          ),
        ).toHaveLength(1);
        expect(
          (await connectionRepo.findOneByOrFail({ id: connection.id })).state,
        ).toBe(ConnectionState.COMPLETED);
      } finally {
        emit.mockRestore();
      }
    },
  );

  it('rolls the connection transition back when its durable notification fails', async () => {
    prepareBackend();
    await connectionRepo.update(connection.id, {
      state: ConnectionState.INVITED,
    });
    const enqueue = jest
      .spyOn(app.get(JobsService), 'sendInTransaction')
      .mockRejectedValueOnce(new Error('notification unavailable'));
    const emit = jest.spyOn(app.get(EventEmitter2), 'emit');
    try {
      await expect(
        app
          .get(ConnectionService)
          .resolveForIssuance(
            tenant.id,
            connection.id,
            connection.connectorId!,
          ),
      ).rejects.toThrow('notification unavailable');
      expect(
        (await connectionRepo.findOneByOrFail({ id: connection.id })).state,
      ).toBe(ConnectionState.INVITED);
      expect(
        emit.mock.calls.filter(([event]) => event === 'connection.established'),
      ).toHaveLength(0);
    } finally {
      enqueue.mockRestore();
      emit.mockRestore();
    }
  });

  it.each(['credential_issued', 'abandoned'])(
    'reconciles %s after local and remote holder abandonment without allowing new offers',
    async (state) => {
      prepareBackend(state);
      const offered = await request(app.getHttpServer())
        .post(`${API_BASE_PATH}/tenants/${tenant.id}/credentials/offer`)
        .send(offerBody())
        .expect(202);
      const operationId = (offered.body as { id: string }).id;
      await connectionRepo.update(connection.id, {
        state: ConnectionState.ABANDONED,
        connectorId: null,
        metadata: { invitationId: `invitation-${tenant.id}` },
      });
      const original = backendRequest.getMockImplementation()!;
      backendRequest.mockImplementation((config, retry) => {
        if (config.url.endsWith('/connections')) {
          return Promise.resolve({
            data: {
              results: [
                {
                  connection_id: connection.externalConnectionId,
                  invitation_msg_id: `invitation-${tenant.id}`,
                  state: 'error',
                },
              ],
            },
          });
        }
        if (config.url.includes('/connections/')) {
          return Promise.resolve({
            data: {
              connection_id: connection.externalConnectionId,
              state: 'error',
            },
          });
        }
        return original(config, retry);
      });
      mockBoss.send.mockClear();
      await request(app.getHttpServer())
        .post(
          `${API_BASE_PATH}/tenants/${tenant.id}/credentials/offer/${operationId}/reconcile`,
        )
        .expect(200)
        .expect(({ body }: { body: { state: string } }) => {
          expect(body.state).toBe(
            state === 'abandoned' ? 'failed' : 'completed',
          );
        });
      expect(
        await connectionRepo.findOneByOrFail({ id: connection.id }),
      ).toMatchObject({
        state: ConnectionState.ABANDONED,
        connectorId: connection.connectorId,
      });
      expect(
        mockBoss.send.mock.calls.filter(
          ([queue, payload]) =>
            queue === 'webhook.dispatch' &&
            payload.event ===
              (state === 'abandoned'
                ? 'credential.rejected'
                : 'credential.issued'),
        ),
      ).toHaveLength(1);
      await request(app.getHttpServer())
        .post(`${API_BASE_PATH}/tenants/${tenant.id}/credentials/offer`)
        .send(offerBody())
        .expect(409);
      expect(
        backendRequest.mock.calls.filter(
          ([config]) => config.method === 'POST',
        ),
      ).toHaveLength(1);
    },
  );

  it.each(['/records/', '/connections/'])(
    'returns 409 for a missing backend correlation at %s and never resends',
    async (path) => {
      prepareBackend();
      const offered = await request(app.getHttpServer())
        .post(`${API_BASE_PATH}/tenants/${tenant.id}/credentials/offer`)
        .send(offerBody())
        .expect(202);
      const operationId = (offered.body as { id: string }).id;
      const original = backendRequest.getMockImplementation()!;
      backendRequest.mockImplementation((config, retry) =>
        config.url.includes(path)
          ? Promise.reject(
              Object.assign(new Error('record deleted'), {
                isAxiosError: true,
                response: { status: 404 },
              }),
            )
          : original(config, retry),
      );
      await request(app.getHttpServer())
        .post(
          `${API_BASE_PATH}/tenants/${tenant.id}/credentials/offer/${operationId}/reconcile`,
        )
        .expect(409);
      expect(
        backendRequest.mock.calls.filter(
          ([config]) => config.method === 'POST',
        ),
      ).toHaveLength(1);
    },
  );
  it.each([ConnectionState.INVITED, ConnectionState.ABANDONED])(
    'adopts an exactly matched legacy invitation without reviving %s connections',
    async (state) => {
      prepareBackend();
      await connectionRepo.update(connection.id, {
        connectorId: null,
        externalConnectionId: null,
        state,
        metadata: { invitationId: `invitation-${tenant.id}` },
      });
      await request(app.getHttpServer())
        .post(`${API_BASE_PATH}/tenants/${tenant.id}/credentials/offer`)
        .send(offerBody())
        .expect(state === ConnectionState.INVITED ? 202 : 409);
      expect(
        backendRequest.mock.calls
          .filter(([config]) => config.url.endsWith('/connections'))
          .map(([config]) => config.params),
      ).toEqual([
        expect.objectContaining({
          invitation_msg_id: `invitation-${tenant.id}`,
          limit: 2,
          offset: 0,
        }),
      ]);
      const saved = await connectionRepo.findOneByOrFail({ id: connection.id });
      expect(saved).toMatchObject({
        connectorId: connection.connectorId,
        externalConnectionId: connection.externalConnectionId,
        state:
          state === ConnectionState.INVITED
            ? ConnectionState.COMPLETED
            : ConnectionState.ABANDONED,
      });
      expect(
        backendRequest.mock.calls.filter(
          ([config]: [{ method: string }]) => config.method === 'POST',
        ),
      ).toHaveLength(state === ConnectionState.INVITED ? 1 : 0);
    },
  );
});
