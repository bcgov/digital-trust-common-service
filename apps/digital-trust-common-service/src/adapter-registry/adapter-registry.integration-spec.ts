import { randomUUID } from 'crypto';

import { AuthContext } from '@app/auth';
import {
  ConnectorUnavailableError,
  CredentialFormat,
  MockAdapter,
  ConnectorType as PortConnectorType,
} from '@app/credential-ports';
import { PgBossService } from '@app/pg-boss';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { AppModule } from '../app.module';
import { ConnectorType } from '../connection/connection.entity';
import { ConnectorCredential } from '../connector-credential/connector-credential.entity';
import { ConnectorCredentialService } from '../connector-credential/connector-credential.service';

import { AdapterRegistry } from './adapter-registry.service';

const mockBoss = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  send: jest.fn().mockResolvedValue(undefined),
  createQueue: jest.fn().mockResolvedValue(undefined),
  schedule: jest.fn().mockResolvedValue(undefined),
  work: jest.fn().mockResolvedValue(undefined),
};

/**
 * The resolution matrix against real rows: tenant config JSONB, the encrypted
 * connector_credential envelope, and cross-tenant queries. The unit spec proves
 * the branching with mocks; this proves the queries and the JSONB read actually
 * behave that way in PostgreSQL.
 */
describe('AdapterRegistry (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let registry: AdapterRegistry;
  let connectors: ConnectorCredentialService;
  let adapter: MockAdapter;

  const createdTenantIds: string[] = [];

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

    dataSource = moduleFixture.get(DataSource);
    registry = moduleFixture.get(AdapterRegistry);
    connectors = moduleFixture.get(ConnectorCredentialService);
  });

  beforeEach(() => {
    registry.reset();
    adapter = new MockAdapter({
      connectorType: PortConnectorType.Traction,
      supportedFormats: [CredentialFormat.AnonCreds],
    });
    registry.register(adapter);
  });

  afterEach(async () => {
    // Shared database, maxWorkers 1 — clean up only the rows this spec made.
    for (const tenantId of createdTenantIds.splice(0)) {
      await dataSource.query(
        'DELETE FROM connector_credential WHERE tenant_id = $1',
        [tenantId],
      );
      await dataSource.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    }
    registry.reset();
  });

  afterAll(async () => {
    await app.close();
  });

  async function createTenant(): Promise<string> {
    const rows = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO tenant (name, slug, config)
       VALUES ($1, $2, '{}'::jsonb) RETURNING id`,
      [`Adapter Registry ${randomUUID()}`, `adapter-registry-${randomUUID()}`],
    );

    createdTenantIds.push(rows[0].id);
    return rows[0].id;
  }

  /**
   * Scoped to the tenant being written rather than platform-admin, so these
   * writes go through the same tenant check a real caller would.
   */
  function authFor(tenantId: string): AuthContext {
    return {
      sub: 'adapter-registry-integration',
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

  async function createConnector(
    tenantId: string,
    overrides: {
      connectorType?: ConnectorType;
      active?: boolean;
      endpointUrl?: string;
    } = {},
  ): Promise<ConnectorCredential> {
    return await connectors.create(
      {
        tenantId,
        connectorType: overrides.connectorType ?? ConnectorType.TRACTION,
        credentialsPlainText: JSON.stringify({ apiKey: 'integration-secret' }),
        endpointUrl: overrides.endpointUrl ?? 'https://traction.example.com',
        active: overrides.active ?? true,
      },
      authFor(tenantId),
    );
  }

  async function setDefaultConnector(
    tenantId: string,
    connectorId: string,
  ): Promise<void> {
    await dataSource.query(
      `UPDATE tenant SET config = jsonb_set(config, '{default_connector}', to_jsonb($2::text)) WHERE id = $1`,
      [tenantId, connectorId],
    );
  }

  it('should resolve the connector named by tenant.config.default_connector', async () => {
    const tenantId = await createTenant();
    const connector = await createConnector(tenantId, {
      endpointUrl: 'https://named.example.com',
    });
    await setDefaultConnector(tenantId, connector.id);

    const resolved = await registry.resolve(tenantId);

    expect(resolved.adapter).toBe(adapter);
    expect(resolved.connector.id).toBe(connector.id);
    expect(resolved.connector.endpointUrl).toBe('https://named.example.com');
    expect(resolved.format).toBe(CredentialFormat.AnonCreds);
  });

  it('should fall back to the tenant single active connector when no default is set', async () => {
    const tenantId = await createTenant();
    const connector = await createConnector(tenantId);

    const resolved = await registry.resolve(tenantId);

    expect(resolved.connector.id).toBe(connector.id);
  });

  it('should ignore inactive connectors in the fallback', async () => {
    const tenantId = await createTenant();
    const active = await createConnector(tenantId);
    await createConnector(tenantId, {
      connectorType: ConnectorType.CREDO,
      active: false,
    });

    const resolved = await registry.resolve(tenantId);

    expect(resolved.connector.id).toBe(active.id);
  });

  it('should refuse an inactive default_connector', async () => {
    const tenantId = await createTenant();
    const connector = await createConnector(tenantId, { active: false });
    await setDefaultConnector(tenantId, connector.id);

    await expect(registry.resolve(tenantId)).rejects.toBeInstanceOf(
      ConnectorUnavailableError,
    );
  });

  it('should throw when the tenant has no connector at all', async () => {
    const tenantId = await createTenant();

    await expect(registry.resolve(tenantId)).rejects.toBeInstanceOf(
      ConnectorUnavailableError,
    );
  });

  it('should throw when the fallback is ambiguous', async () => {
    const tenantId = await createTenant();
    await createConnector(tenantId);
    await createConnector(tenantId, { connectorType: ConnectorType.CREDO });

    await expect(registry.resolve(tenantId)).rejects.toBeInstanceOf(
      ConnectorUnavailableError,
    );
  });

  it('should throw when no adapter is registered for the connector type', async () => {
    const tenantId = await createTenant();
    const connector = await createConnector(tenantId, {
      connectorType: ConnectorType.CREDO,
    });
    await setDefaultConnector(tenantId, connector.id);

    await expect(registry.resolve(tenantId)).rejects.toBeInstanceOf(
      ConnectorUnavailableError,
    );
  });

  it('should never resolve another tenant connector', async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const connectorA = await createConnector(tenantA);
    const connectorB = await createConnector(tenantB);

    // Tenant B's config points at tenant A's connector.
    await setDefaultConnector(tenantB, connectorA.id);

    await expect(registry.resolve(tenantB)).rejects.toBeInstanceOf(
      ConnectorUnavailableError,
    );

    // And an explicit cross-tenant connectorId is refused too.
    await expect(
      registry.resolve(tenantA, undefined, { connectorId: connectorB.id }),
    ).rejects.toBeInstanceOf(ConnectorUnavailableError);
  });
});
