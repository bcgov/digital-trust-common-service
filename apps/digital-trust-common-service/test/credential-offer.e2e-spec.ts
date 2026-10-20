import { randomBytes } from 'crypto';

import { JwtGuard, TENANT_SUPERUSER_SCOPE } from '@app/auth';
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
import { ConnectorCredential } from '../src/connector-credential/connector-credential.entity';
import { Credential } from '../src/credential/credential.entity';
import {
  CredentialDefinition,
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
} from '../src/credential-definition/credential-definition.entity';
import { Operation } from '../src/operation/operation.entity';
import { Tenant } from '../src/tenant/tenant.entity';
import { TractionHttpClient } from '../src/traction/traction-http-client.service';
import { TractionTokenManager } from '../src/traction/traction-token-manager.service';
import { TractionAdapter } from '../src/traction/traction.adapter';

const mockBoss = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  send: jest.fn().mockResolvedValue(undefined),
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
    [{ url: string; method: string }, boolean?]
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
