import { randomUUID } from 'crypto';

import { AuthContext } from '@app/auth';
import {
  ConnectorUnavailableError,
  CredentialFormat,
  IssuerPort,
  MockAdapter,
  ConnectorType as PortConnectorType,
  StubAdapter,
} from '@app/credential-ports';
import { PgBossService } from '@app/pg-boss';
import { ForbiddenException, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AdapterRegistry } from '../src/adapter-registry/adapter-registry.service';
import { configureApp } from '../src/app.config';
import { AppModule } from '../src/app.module';
import { ConnectorType } from '../src/connection/connection.entity';
import { ConnectorCredentialService } from '../src/connector-credential/connector-credential.service';

const mockBoss = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  send: jest.fn().mockResolvedValue(undefined),
  createQueue: jest.fn().mockResolvedValue(undefined),
  schedule: jest.fn().mockResolvedValue(undefined),
  work: jest.fn().mockResolvedValue(undefined),
};

async function bootstrap(): Promise<TestingModule> {
  return await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PgBossService)
    .useValue({
      boss: mockBoss,
      initializeBoss: jest.fn().mockResolvedValue(mockBoss),
    })
    .compile();
}

/**
 * The registry exposes no HTTP route, so this is a service-level e2e in the
 * same shape as operation-lifecycle.e2e-spec.ts: the whole AppModule is booted
 * so the real DI graph, the real ConfigService, and real database rows are
 * exercised.
 *
 * Scope is deliberately what the cheaper tiers cannot prove. The full
 * resolution matrix lives in adapter-registry.integration-spec.ts.
 */
describe('AdapterRegistry (e2e)', () => {
  let moduleFixture: TestingModule;
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let registry: AdapterRegistry;
  let connectors: ConnectorCredentialService;

  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    moduleFixture = await bootstrap();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    registry = moduleFixture.get(AdapterRegistry);
    connectors = moduleFixture.get(ConnectorCredentialService);
  });

  beforeEach(() => {
    registry.reset();
  });

  afterEach(async () => {
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

  async function createTenant(defaultConnectorId?: string): Promise<string> {
    const config = defaultConnectorId
      ? JSON.stringify({ default_connector: defaultConnectorId })
      : '{}';

    const rows = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO tenant (name, slug, config)
       VALUES ($1, $2, $3::jsonb) RETURNING id`,
      [`Adapter E2E ${randomUUID()}`, `adapter-e2e-${randomUUID()}`, config],
    );

    createdTenantIds.push(rows[0].id);
    return rows[0].id;
  }

  function tractionAdapter(): MockAdapter {
    return new MockAdapter({
      connectorType: PortConnectorType.Traction,
      supportedFormats: [CredentialFormat.AnonCreds],
    });
  }

  /**
   * Scoped to the tenant being written rather than platform-admin, so these
   * writes go through the same tenant check a real caller would.
   */
  function authFor(tenantId: string): AuthContext {
    return {
      sub: 'adapter-registry-e2e',
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

  describe('dependency injection', () => {
    it('should resolve AdapterRegistry from the full application graph', () => {
      expect(moduleFixture.get(AdapterRegistry)).toBeInstanceOf(
        AdapterRegistry,
      );
    });

    it('should start with no adapters registered', () => {
      // Changes once a real adapter module self-registers at startup.
      expect(registry.list()).toEqual([]);
    });

    it('should leave the fail-closed StubAdapter port bindings intact', async () => {
      const issuer = moduleFixture.get<IssuerPort>(IssuerPort);

      expect(issuer).toBeInstanceOf(StubAdapter);
      await expect(
        issuer.offerCredential({
          format: CredentialFormat.AnonCreds,
          attributes: [],
        }),
      ).rejects.toThrow();
    });
  });

  describe('resolution over real rows', () => {
    it('should resolve a tenant default connector written through the encryption envelope', async () => {
      const adapter = tractionAdapter();
      registry.register(adapter);

      const tenantId = await createTenant();
      const connector = await connectors.create(
        {
          tenant_id: tenantId,
          connector_type: ConnectorType.TRACTION,
          credentials_plain_text: JSON.stringify({ apiKey: 'e2e-secret' }),
          endpoint_url: 'https://traction-e2e.example.com',
          active: true,
        },
        authFor(tenantId),
      );
      await dataSource.query(
        `UPDATE tenant SET config = jsonb_set(config, '{default_connector}', to_jsonb($2::text)) WHERE id = $1`,
        [tenantId, connector.id],
      );

      const resolved = await registry.resolve(tenantId);

      expect(resolved.adapter).toBe(adapter);
      expect(resolved.connector.id).toBe(connector.id);
      expect(resolved.connector.endpointUrl).toBe(
        'https://traction-e2e.example.com',
      );
      expect(resolved.connector.keyVersion).toBeGreaterThan(0);
      expect(resolved.format).toBe(CredentialFormat.AnonCreds);
    });

    it('should never resolve another tenant connector', async () => {
      registry.register(tractionAdapter());

      const tenantA = await createTenant();
      const tenantB = await createTenant();
      const connectorA = await connectors.create(
        {
          tenant_id: tenantA,
          connector_type: ConnectorType.TRACTION,
          credentials_plain_text: JSON.stringify({ apiKey: 'tenant-a' }),
          endpoint_url: 'https://tenant-a.example.com',
          active: true,
        },
        authFor(tenantA),
      );

      await expect(
        registry.resolve(tenantB, undefined, { connectorId: connectorA.id }),
      ).rejects.toBeInstanceOf(ConnectorUnavailableError);
    });
  });

  describe('ADAPTER_OVERRIDE_ENABLED through the real ConfigService', () => {
    it('should fail closed when the flag is unset', async () => {
      expect(process.env.ADAPTER_OVERRIDE_ENABLED).toBeUndefined();

      registry.register(tractionAdapter());
      const tenantId = await createTenant();

      await expect(
        registry.resolve(tenantId, undefined, {
          adapterOverride: PortConnectorType.Traction,
          isPlatformAdmin: true,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    describe('with the flag enabled', () => {
      let enabledFixture: TestingModule;
      let enabledApp: INestApplication<App>;
      let enabledRegistry: AdapterRegistry;
      let enabledConnectors: ConnectorCredentialService;
      let enabledDataSource: DataSource;

      beforeAll(async () => {
        process.env.ADAPTER_OVERRIDE_ENABLED = 'true';

        enabledFixture = await bootstrap();
        enabledApp = enabledFixture.createNestApplication();
        configureApp(enabledApp);
        await enabledApp.init();

        enabledRegistry = enabledFixture.get(AdapterRegistry);
        enabledConnectors = enabledFixture.get(ConnectorCredentialService);
        enabledDataSource = enabledFixture.get(DataSource);
      });

      afterAll(async () => {
        await enabledApp.close();
        delete process.env.ADAPTER_OVERRIDE_ENABLED;
      });

      it('should honour the override for a platform-admin caller', async () => {
        const adapter = tractionAdapter();
        enabledRegistry.reset();
        enabledRegistry.register(adapter);

        const rows = await enabledDataSource.query<Array<{ id: string }>>(
          `INSERT INTO tenant (name, slug, config)
           VALUES ($1, $2, '{}'::jsonb) RETURNING id`,
          [
            `Adapter E2E override ${randomUUID()}`,
            `adapter-e2e-override-${randomUUID()}`,
          ],
        );
        const tenantId = rows[0].id;
        createdTenantIds.push(tenantId);

        await enabledConnectors.create(
          {
            tenant_id: tenantId,
            connector_type: ConnectorType.TRACTION,
            credentials_plain_text: JSON.stringify({ apiKey: 'override' }),
            endpoint_url: 'https://override.example.com',
            active: true,
          },
          authFor(tenantId),
        );

        const resolved = await enabledRegistry.resolve(tenantId, undefined, {
          adapterOverride: PortConnectorType.Traction,
          isPlatformAdmin: true,
        });

        expect(resolved.adapter).toBe(adapter);
        expect(resolved.connector.endpointUrl).toBe(
          'https://override.example.com',
        );
      });

      it('should still reject the override for a non-platform-admin caller', async () => {
        enabledRegistry.reset();
        enabledRegistry.register(tractionAdapter());

        await expect(
          enabledRegistry.resolve(randomUUID(), undefined, {
            adapterOverride: PortConnectorType.Traction,
            isPlatformAdmin: false,
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });
    });
  });
});
