import { AppDataSource } from '@app/database/data-source';
import { buildSslConfig } from '@app/database/ssl.util';
import { OidcConfigService } from '@app/oidc';
import { Test, TestingModule } from '@nestjs/testing';
import { verify } from 'argon2';
import { DataSource } from 'typeorm';

import { BootstrapModule } from './bootstrap.module';
import {
  ADMIN_CLIENT_ID,
  EnvironmentBootstrapService,
  UI_CLIENT_ID,
} from './bootstrap.service';

const TENANT_SLUG = 'bootstrap-integration';
const TENANT_NAME = 'Bootstrap integration';

interface ClientRow {
  tenant_id: string;
  is_public: boolean;
  client_secret_hash: string | null;
  redirect_uris: string[];
  post_logout_redirect_uris: string[];
  grant_types: string[];
  roles: string[];
  revoked_at: string | null;
}

describe('EnvironmentBootstrapService integration', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let bootstrap: EnvironmentBootstrapService;
  let origin: string;

  beforeAll(async () => {
    // The real migration list, as the seed's spec does, so this spec does not
    // depend on a sibling having migrated the shared test database first.
    const migrationDataSource = new DataSource({
      ...AppDataSource.options,
      entities: [],
      ssl: buildSslConfig(
        process.env.DB_SSL,
        process.env.DB_SSL_REJECT_UNAUTHORIZED,
        process.env.DB_SSL_CA,
      ),
    } as DataSource['options']);

    await migrationDataSource.initialize();
    await migrationDataSource.runMigrations();
    await migrationDataSource.destroy();

    // Boot the module the CLI boots, not a hand-assembled copy of it. TypeORM
    // resolves every registered entity's relations when the connection
    // initialises, so an entity missing from the module's registration fails
    // here — before any row is written — exactly as it does in a pod.
    module = await Test.createTestingModule({
      imports: [BootstrapModule],
    }).compile();

    await module.init();

    dataSource = module.get(DataSource);
    bootstrap = module.get(EnvironmentBootstrapService);
    origin = new URL(module.get(OidcConfigService).getConfig().issuer).origin;

    await removeBootstrapRows();
  });

  afterAll(async () => {
    if (module) {
      await removeBootstrapRows();
      await module.close();
    }
  });

  // Both client ids are fixed, so they are removed by id as well as by the
  // tenant cascade: a client left under another tenant (the dev seed also
  // registers the UI client) would otherwise be re-registered rather than
  // created, and the first-run assertions below would not hold.
  async function removeBootstrapRows(): Promise<void> {
    await dataSource.query(
      `DELETE FROM oauth_client WHERE client_id IN ($1, $2)`,
      [UI_CLIENT_ID, ADMIN_CLIENT_ID],
    );
    await dataSource.query(`DELETE FROM tenant WHERE slug = $1`, [TENANT_SLUG]);
  }

  async function findClient(clientId: string): Promise<ClientRow | undefined> {
    const rows = await dataSource.query<ClientRow[]>(
      `SELECT tenant_id, is_public, client_secret_hash, redirect_uris,
              post_logout_redirect_uris, grant_types, roles, revoked_at
         FROM oauth_client WHERE client_id = $1`,
      [clientId],
    );
    return rows[0];
  }

  async function countRows(table: string, where: string): Promise<number> {
    const rows = await dataSource.query<Array<{ count: string }>>(
      `SELECT COUNT(*)::text AS count FROM ${table} WHERE ${where}`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  it('creates the tenant, the UI client and the platform-admin client once', async () => {
    const first = await bootstrap.run(TENANT_SLUG, TENANT_NAME);

    expect(first.redirectUris).toEqual([`${origin}/auth/callback`]);
    expect(first.adminClientSecret).toMatch(/^[0-9a-f]{64}$/);

    expect(
      await countRows(
        'tenant',
        `slug = '${TENANT_SLUG}' AND status = 'active' AND deleted_at IS NULL`,
      ),
    ).toBe(1);

    const uiClient = await findClient(UI_CLIENT_ID);
    expect(uiClient).toMatchObject({
      tenant_id: first.tenantId,
      is_public: true,
      client_secret_hash: null,
      redirect_uris: [`${origin}/auth/callback`],
      post_logout_redirect_uris: [`${origin}/login`],
      grant_types: ['authorization_code', 'refresh_token'],
      revoked_at: null,
    });

    const adminClient = await findClient(ADMIN_CLIENT_ID);
    expect(adminClient).toMatchObject({
      tenant_id: first.tenantId,
      is_public: false,
      grant_types: ['client_credentials'],
      roles: ['platform-admin'],
      revoked_at: null,
    });
    // Only the hash is stored; the printed secret must verify against it.
    expect(
      await verify(
        adminClient?.client_secret_hash ?? '',
        first.adminClientSecret ?? '',
      ),
    ).toBe(true);

    // A re-run re-registers the UI client in place and leaves the
    // platform-admin client's secret alone.
    const second = await bootstrap.run(TENANT_SLUG, TENANT_NAME);

    expect(second.tenantId).toBe(first.tenantId);
    expect(second.adminClientSecret).toBeUndefined();
    expect(
      await countRows(
        'oauth_client',
        `client_id IN ('${UI_CLIENT_ID}', '${ADMIN_CLIENT_ID}')`,
      ),
    ).toBe(2);
    expect((await findClient(ADMIN_CLIENT_ID))?.client_secret_hash).toBe(
      adminClient?.client_secret_hash,
    );

    // Rotation mints a new secret and invalidates the old one.
    const rotated = await bootstrap.run(TENANT_SLUG, TENANT_NAME, true);
    const rotatedHash =
      (await findClient(ADMIN_CLIENT_ID))?.client_secret_hash ?? '';

    expect(rotated.adminClientSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(rotated.adminClientSecret).not.toBe(first.adminClientSecret);
    expect(await verify(rotatedHash, rotated.adminClientSecret ?? '')).toBe(
      true,
    );
    expect(await verify(rotatedHash, first.adminClientSecret ?? '')).toBe(
      false,
    );
  });
});
