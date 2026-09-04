import { PgBossService } from '@app/pg-boss';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Job } from 'pg-boss';
import { Repository } from 'typeorm';

import { AppModule } from '../app.module';
import {
  ConnectionProtocol,
  ConnectionState,
  Connection,
  ConnectorType,
} from '../connection/connection.entity';
import { ConnectorCredential } from '../connector-credential/connector-credential.entity';
import {
  OAuthClient,
  OAuthClientRevokedReason,
} from '../oauth-client/oauth-client.entity';

import { TenantStatusChangeWorker } from './tenant-status-change.worker';
import { Tenant, TenantStatus } from './tenant.entity';
import type { TenantStatusChangeJobData } from './tenant.service';

const mockBoss = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  send: jest.fn().mockResolvedValue(undefined),
  createQueue: jest.fn().mockResolvedValue(undefined),
  schedule: jest.fn().mockResolvedValue(undefined),
  work: jest.fn().mockResolvedValue(undefined),
};

/**
 * `oauth-client.repository.spec.ts`, `connector-credential.repository.spec.ts`,
 * and `connection.repository.spec.ts` all fully mock the TypeORM repository,
 * so none of them prove that the bulk `update()` calls in
 * `revokeAllForTenant`/`deactivateAllForTenant`/`abandonAllForTenant`/
 * `restoreAllForTenant` actually scope to one tenant against a real
 * Postgres instance, or that they leave already-terminal/individually-revoked
 * rows alone. `tenant-status-change.worker.spec.ts` mocks all three services,
 * so it doesn't prove the worker's cascade composes correctly with the real
 * repositories either. This closes both gaps by seeding two tenants' worth
 * of real rows and driving the cascade through the actual worker.
 */
describe('TenantStatusChange cascade (integration)', () => {
  let app: INestApplication;
  let worker: TenantStatusChangeWorker;
  let tenantRepo: Repository<Tenant>;
  let oauthClientRepo: Repository<OAuthClient>;
  let connectorCredentialRepo: Repository<ConnectorCredential>;
  let connectionRepo: Repository<Connection>;
  let tenantAId: string;
  let tenantBId: string;

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
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    worker = moduleFixture.get(TenantStatusChangeWorker);
    tenantRepo = moduleFixture.get(getRepositoryToken(Tenant));
    oauthClientRepo = moduleFixture.get(getRepositoryToken(OAuthClient));
    connectorCredentialRepo = moduleFixture.get(
      getRepositoryToken(ConnectorCredential),
    );
    connectionRepo = moduleFixture.get(getRepositoryToken(Connection));
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const [tenantA, tenantB] = await Promise.all([
      tenantRepo.save(
        tenantRepo.create({
          name: `Cascade Tenant A ${Date.now()}`,
          slug: `cascade-tenant-a-${Math.random().toString(36).slice(2)}`,
        }),
      ),
      tenantRepo.save(
        tenantRepo.create({
          name: `Cascade Tenant B ${Date.now()}`,
          slug: `cascade-tenant-b-${Math.random().toString(36).slice(2)}`,
        }),
      ),
    ]);
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;
  });

  afterEach(async () => {
    await oauthClientRepo.delete({ tenantId: tenantAId });
    await oauthClientRepo.delete({ tenantId: tenantBId });
    await connectorCredentialRepo.delete({ tenantId: tenantAId });
    await connectorCredentialRepo.delete({ tenantId: tenantBId });
    await connectionRepo.delete({ tenantId: tenantAId });
    await connectionRepo.delete({ tenantId: tenantBId });
    await tenantRepo.delete({ id: tenantAId });
    await tenantRepo.delete({ id: tenantBId });
  });

  const seedOAuthClient = (
    tenantId: string,
    overrides: Partial<OAuthClient> = {},
  ): Promise<OAuthClient> =>
    oauthClientRepo.save(
      oauthClientRepo.create({
        tenantId,
        clientId: `cascade-client-${Math.random().toString(36).slice(2)}`,
        clientSecretHash: 'hash',
        name: 'Cascade Test Client',
        scopes: [],
        ...overrides,
      }),
    );

  const seedConnectorCredential = (
    tenantId: string,
    overrides: Partial<ConnectorCredential> = {},
  ): Promise<ConnectorCredential> =>
    connectorCredentialRepo.save(
      connectorCredentialRepo.create({
        tenantId,
        connectorType: ConnectorType.TRACTION,
        credentialsEncrypted: Buffer.from('encrypted'),
        endpointUrl: 'https://traction.example.test',
        active: true,
        ...overrides,
      }),
    );

  const seedConnection = (
    tenantId: string,
    overrides: Partial<Connection> = {},
  ): Promise<Connection> =>
    connectionRepo.save(
      connectionRepo.create({
        tenantId,
        externalConnectionId: `cascade-conn-${Math.random().toString(36).slice(2)}`,
        state: ConnectionState.ACTIVE,
        connectorType: ConnectorType.TRACTION,
        protocol: ConnectionProtocol.DIDCOMM_V1,
        ...overrides,
      }),
    );

  const job = (
    data: TenantStatusChangeJobData,
  ): Job<TenantStatusChangeJobData> =>
    ({ id: 'cascade-it-job', data }) as Job<TenantStatusChangeJobData>;

  it('deactivation revokes clients, deactivates credentials, and abandons connections for that tenant only', async () => {
    const clientA = await seedOAuthClient(tenantAId);
    const credentialA = await seedConnectorCredential(tenantAId);
    const connectionA = await seedConnection(tenantAId);
    const clientB = await seedOAuthClient(tenantBId);
    const credentialB = await seedConnectorCredential(tenantBId);
    const connectionB = await seedConnection(tenantBId);

    await worker.handle(
      job({
        tenantId: tenantAId,
        previousStatus: TenantStatus.ACTIVE,
        status: TenantStatus.DEACTIVATED,
      }),
    );

    const [
      reloadedClientA,
      reloadedCredentialA,
      reloadedConnectionA,
      reloadedClientB,
      reloadedCredentialB,
      reloadedConnectionB,
    ] = await Promise.all([
      oauthClientRepo.findOneByOrFail({ id: clientA.id }),
      connectorCredentialRepo.findOneByOrFail({ id: credentialA.id }),
      connectionRepo.findOneByOrFail({ id: connectionA.id }),
      oauthClientRepo.findOneByOrFail({ id: clientB.id }),
      connectorCredentialRepo.findOneByOrFail({ id: credentialB.id }),
      connectionRepo.findOneByOrFail({ id: connectionB.id }),
    ]);

    expect(reloadedClientA.revokedAt).not.toBeNull();
    expect(reloadedClientA.revokedReason).toBe(
      OAuthClientRevokedReason.TENANT_DEACTIVATION,
    );
    expect(reloadedCredentialA.active).toBe(false);
    expect(reloadedConnectionA.state).toBe(ConnectionState.ABANDONED);

    // Tenant B was never named in the job, so none of its rows should move.
    expect(reloadedClientB.revokedAt).toBeNull();
    expect(reloadedClientB.revokedReason).toBeNull();
    expect(reloadedCredentialB.active).toBe(true);
    expect(reloadedConnectionB.state).toBe(ConnectionState.ACTIVE);
  });

  it('does not re-revoke a client already revoked for cause, and does not resurrect it on reactivation', async () => {
    const individuallyRevokedAt = new Date('2020-01-01T00:00:00Z');
    const revokedForCause = await seedOAuthClient(tenantAId, {
      revokedAt: individuallyRevokedAt,
      revokedReason: null,
    });
    const activeClient = await seedOAuthClient(tenantAId);

    await worker.handle(
      job({
        tenantId: tenantAId,
        previousStatus: TenantStatus.ACTIVE,
        status: TenantStatus.DEACTIVATED,
      }),
    );

    const reloadedRevokedForCause = await oauthClientRepo.findOneByOrFail({
      id: revokedForCause.id,
    });
    const reloadedActiveClient = await oauthClientRepo.findOneByOrFail({
      id: activeClient.id,
    });

    // Individually-revoked client is untouched: same timestamp, reason still null.
    expect(reloadedRevokedForCause.revokedAt?.toISOString()).toBe(
      individuallyRevokedAt.toISOString(),
    );
    expect(reloadedRevokedForCause.revokedReason).toBeNull();
    // The previously-active client was bulk-revoked and tagged.
    expect(reloadedActiveClient.revokedAt).not.toBeNull();
    expect(reloadedActiveClient.revokedReason).toBe(
      OAuthClientRevokedReason.TENANT_DEACTIVATION,
    );

    await worker.handle(
      job({
        tenantId: tenantAId,
        previousStatus: TenantStatus.DEACTIVATED,
        status: TenantStatus.ACTIVE,
      }),
    );

    const [restoredForCause, restoredBulk] = await Promise.all([
      oauthClientRepo.findOneByOrFail({ id: revokedForCause.id }),
      oauthClientRepo.findOneByOrFail({ id: activeClient.id }),
    ]);

    // Reactivation only restores clients tagged TENANT_DEACTIVATION.
    expect(restoredForCause.revokedAt?.toISOString()).toBe(
      individuallyRevokedAt.toISOString(),
    );
    expect(restoredBulk.revokedAt).toBeNull();
    expect(restoredBulk.revokedReason).toBeNull();
  });

  it('reactivation does not restore connector credentials or connections', async () => {
    const credential = await seedConnectorCredential(tenantAId, {
      active: false,
    });
    const connection = await seedConnection(tenantAId, {
      state: ConnectionState.ABANDONED,
    });

    await worker.handle(
      job({
        tenantId: tenantAId,
        previousStatus: TenantStatus.DEACTIVATED,
        status: TenantStatus.ACTIVE,
      }),
    );

    const [reloadedCredential, reloadedConnection] = await Promise.all([
      connectorCredentialRepo.findOneByOrFail({ id: credential.id }),
      connectionRepo.findOneByOrFail({ id: connection.id }),
    ]);

    expect(reloadedCredential.active).toBe(false);
    expect(reloadedConnection.state).toBe(ConnectionState.ABANDONED);
  });

  it('does not abandon connections already completed or already abandoned', async () => {
    const completed = await seedConnection(tenantAId, {
      state: ConnectionState.COMPLETED,
    });
    const alreadyAbandoned = await seedConnection(tenantAId, {
      state: ConnectionState.ABANDONED,
    });
    const active = await seedConnection(tenantAId, {
      state: ConnectionState.ACTIVE,
    });

    await worker.handle(
      job({
        tenantId: tenantAId,
        previousStatus: TenantStatus.ACTIVE,
        status: TenantStatus.DEACTIVATED,
      }),
    );

    const [reloadedCompleted, reloadedAbandoned, reloadedActive] =
      await Promise.all([
        connectionRepo.findOneByOrFail({ id: completed.id }),
        connectionRepo.findOneByOrFail({ id: alreadyAbandoned.id }),
        connectionRepo.findOneByOrFail({ id: active.id }),
      ]);

    expect(reloadedCompleted.state).toBe(ConnectionState.COMPLETED);
    expect(reloadedAbandoned.state).toBe(ConnectionState.ABANDONED);
    expect(reloadedActive.state).toBe(ConnectionState.ABANDONED);
  });

  it('suspension does not cascade to clients, credentials, or connections', async () => {
    const client = await seedOAuthClient(tenantAId);
    const credential = await seedConnectorCredential(tenantAId);
    const connection = await seedConnection(tenantAId);

    await worker.handle(
      job({
        tenantId: tenantAId,
        previousStatus: TenantStatus.ACTIVE,
        status: TenantStatus.SUSPENDED,
      }),
    );

    const [reloadedClient, reloadedCredential, reloadedConnection] =
      await Promise.all([
        oauthClientRepo.findOneByOrFail({ id: client.id }),
        connectorCredentialRepo.findOneByOrFail({ id: credential.id }),
        connectionRepo.findOneByOrFail({ id: connection.id }),
      ]);

    expect(reloadedClient.revokedAt).toBeNull();
    expect(reloadedCredential.active).toBe(true);
    expect(reloadedConnection.state).toBe(ConnectionState.ACTIVE);
  });
});
