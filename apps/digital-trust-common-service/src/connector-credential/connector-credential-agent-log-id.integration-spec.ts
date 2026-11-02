import { randomUUID } from 'crypto';

import { AuthContext } from '@app/auth';
import { PgBossService } from '@app/pg-boss';
import { ConflictException, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { AppModule } from '../app.module';
import { EncryptionService } from '../common/crypto/encryption.service';
import { ConnectorType } from '../connection/connection.entity';
import { TractionWebhookRegistrar } from '../traction/traction-webhook-registrar.service';

import { ConnectorCredential } from './connector-credential.entity';
import { ConnectorCredentialService } from './connector-credential.service';
import { ConnectorHealthCheckService } from './connector-health-check.service';

const mockBoss = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  send: jest.fn().mockResolvedValue(undefined),
  createQueue: jest.fn().mockResolvedValue(undefined),
  schedule: jest.fn().mockResolvedValue(undefined),
  work: jest.fn().mockResolvedValue(undefined),
};

/**
 * The agent log identifier binding against real rows: the partial unique
 * index, its release on delete and deactivation, and the encrypted blob.
 */
describe('Connector agent log identifier binding (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let connectors: ConnectorCredentialService;
  let encryption: EncryptionService;
  let reportedAgentLogId: string | undefined;

  const createdTenantIds: string[] = [];

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
      .overrideProvider(ConnectorHealthCheckService)
      .useValue({
        check: jest.fn(() =>
          Promise.resolve({
            status: 'healthy',
            latencyMs: 1,
            agentLogId: reportedAgentLogId,
          }),
        ),
      })
      .overrideProvider(TractionWebhookRegistrar)
      .useValue({
        ensureWebhookRegistered: jest.fn().mockResolvedValue(undefined),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    connectors = moduleFixture.get(ConnectorCredentialService);
    encryption = moduleFixture.get(EncryptionService);
  });

  afterEach(async () => {
    for (const tenantId of createdTenantIds.splice(0)) {
      await dataSource.query(
        'DELETE FROM connector_credential WHERE tenant_id = $1',
        [tenantId],
      );
      await dataSource.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  async function createTenant(): Promise<string> {
    const rows = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO tenant (name, slug, config)
       VALUES ($1, $2, '{}'::jsonb) RETURNING id`,
      [`Agent Log Id ${randomUUID()}`, `agent-log-id-${randomUUID()}`],
    );

    createdTenantIds.push(rows[0].id);
    return rows[0].id;
  }

  function authFor(tenantId: string): AuthContext {
    return {
      sub: 'agent-log-id-integration',
      tokenType: 'user',
      clientId: 'spa',
      tenantId,
      roles: [],
      scope: 'tenants:admin',
      scopes: ['tenants:admin'],
      iss: 'http://localhost/oidc',
      aud: 'http://localhost/oidc',
      exp: 9_999_999_999,
      iat: 1,
    };
  }

  function bind(
    tenantId: string,
    walletId: string | undefined,
  ): Promise<ConnectorCredential> {
    reportedAgentLogId = walletId;

    return connectors.create(
      tenantId,
      {
        connectorType: ConnectorType.TRACTION,
        endpointUrl: 'https://traction.example.com',
        credentials: { apiKey: 'integration-secret' },
      },
      authFor(tenantId),
    );
  }

  async function clearDefaultConnector(tenantId: string): Promise<void> {
    await dataSource.query(
      "UPDATE tenant SET config = config - 'default_connector' WHERE id = $1",
      [tenantId],
    );
  }

  it('stores the identifier only inside the encrypted credentials', async () => {
    const tenantId = await createTenant();
    const walletId = randomUUID();

    const connector = await bind(tenantId, walletId);

    const [row] = await dataSource.query<
      Array<Record<string, unknown> & { credentials_encrypted: Buffer }>
    >('SELECT * FROM connector_credential WHERE id = $1', [connector.id]);

    expect(
      encryption.decrypt<{ agentLogId?: string }>(
        row.credentials_encrypted,
        row.key_version as number,
      ).agentLogId,
    ).toBe(walletId);
    expect(row.agent_log_id_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(walletId);
  });

  it('rejects a second tenant binding the same sub-wallet', async () => {
    const walletId = randomUUID();
    const first = await bind(await createTenant(), walletId);

    await expect(bind(await createTenant(), walletId)).rejects.toThrow(
      ConflictException,
    );

    const [row] = await dataSource.query<Array<{ active: boolean }>>(
      'SELECT active FROM connector_credential WHERE id = $1',
      [first.id],
    );
    expect(row.active).toBe(true);
  });

  it('lets exactly one of two concurrent binds win', async () => {
    const walletId = randomUUID();
    const tenantA = await createTenant();
    const tenantB = await createTenant();

    const results = await Promise.allSettled([
      bind(tenantA, walletId),
      bind(tenantB, walletId),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.reason).toBeInstanceOf(ConflictException);
  });

  it('lets a connector re-save the sub-wallet it already holds', async () => {
    const tenantId = await createTenant();
    const walletId = randomUUID();
    const connector = await bind(tenantId, walletId);

    const updated = await connectors.update(
      tenantId,
      connector.id,
      { credentials: { apiKey: 'rotated-secret' } },
      authFor(tenantId),
    );

    expect(updated.agentLogIdHash).toBe(connector.agentLogIdHash);
  });

  it('refuses to rotate onto a sub-wallet another tenant holds and leaves the row unchanged', async () => {
    const heldWallet = randomUUID();
    await bind(await createTenant(), heldWallet);
    const tenantId = await createTenant();
    const connector = await bind(tenantId, randomUUID());

    reportedAgentLogId = heldWallet;
    await expect(
      connectors.update(
        tenantId,
        connector.id,
        { credentials: { apiKey: 'rotated-secret' } },
        authFor(tenantId),
      ),
    ).rejects.toThrow(ConflictException);

    const [row] = await dataSource.query<
      Array<{ agent_log_id_hash: string; credentials_encrypted: Buffer }>
    >(
      'SELECT agent_log_id_hash, credentials_encrypted FROM connector_credential WHERE id = $1',
      [connector.id],
    );
    expect(row.agent_log_id_hash).toBe(connector.agentLogIdHash);
    expect(
      row.credentials_encrypted.equals(connector.credentialsEncrypted),
    ).toBe(true);
  });

  it('releases the binding when the connector is deleted', async () => {
    const walletId = randomUUID();
    const tenantId = await createTenant();
    const connector = await bind(tenantId, walletId);
    await clearDefaultConnector(tenantId);

    await connectors.delete(tenantId, connector.id, authFor(tenantId));

    await expect(bind(await createTenant(), walletId)).resolves.toBeDefined();
  });

  it('releases the binding when the tenant is deactivated', async () => {
    const walletId = randomUUID();
    const tenantId = await createTenant();
    await bind(tenantId, walletId);

    await connectors.deactivateAllForTenant(tenantId);

    await expect(bind(await createTenant(), walletId)).resolves.toBeDefined();
  });

  it('does not bind connectors that report no identifier', async () => {
    const connectorA = await bind(await createTenant(), undefined);
    const connectorB = await bind(await createTenant(), undefined);

    expect(connectorA.agentLogIdHash).toBeNull();
    expect(connectorB.agentLogIdHash).toBeNull();
  });
});
