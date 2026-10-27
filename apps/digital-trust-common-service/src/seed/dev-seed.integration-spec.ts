import { AppDataSource } from '@app/database/data-source';
import { buildSslConfig } from '@app/database/ssl.util';
import { OidcConfigModule, OidcConfigService } from '@app/oidc';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { EncryptionModule } from '../common/crypto/encryption.module';

import {
  MULTI_TENANT_USER,
  UI_SPA_CLIENT_ID,
  seedApiClientId,
  SEED_TENANTS,
  UI_SPA_TENANT_SLUG,
  uiSpaOrigin,
  uiSpaPostLogoutRedirectUris,
  uiSpaRedirectUris,
} from './dev-seed.data';
import { DevSeedService } from './dev-seed.service';
import { SEED_ENTITIES, SEED_REPOSITORY_PROVIDERS } from './seed.constants';

// Set before ConfigModule loads .env, which never overrides an existing
// variable. Not acme-corp.example.test addresses, so the demo counts hold.
process.env.SEED_PLATFORM_OPERATOR_EMAILS =
  'Operator.One@Example.test, operator.two@example.test';

describe('DevSeedService integration', () => {
  let module: TestingModule;
  let migrationDataSource: DataSource;
  let queryDataSource: DataSource;
  let seedService: DevSeedService;

  beforeAll(async () => {
    // The real migration list, not a hand-maintained copy of its first few
    // entries: the seed writes columns that arrive late in the sequence, so a
    // partial list here only passes when a sibling integration spec happens to
    // have migrated the shared test database further first.
    migrationDataSource = new DataSource({
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

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: process.env.DB_HOST,
          port: Number(process.env.DB_PORT),
          username: process.env.DB_USERNAME,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME,
          entities: [...SEED_ENTITIES],
          synchronize: false,
          ssl: buildSslConfig(
            process.env.DB_SSL,
            process.env.DB_SSL_REJECT_UNAUTHORIZED,
            process.env.DB_SSL_CA,
          ),
        }),
        EncryptionModule,
        OidcConfigModule,
        TypeOrmModule.forFeature([...SEED_ENTITIES]),
      ],
      providers: [DevSeedService, ...SEED_REPOSITORY_PROVIDERS],
    }).compile();

    await module.init();

    seedService = module.get(DevSeedService);
    queryDataSource = module.get(DataSource);

    // The seed's tenants persist in the shared test database between runs.
    // Start from no seeded users, so the counts below are this run's work
    // whatever an earlier seed left behind.
    await clearSeededUsers();
  });

  afterAll(async () => {
    delete process.env.SEED_PLATFORM_OPERATOR_EMAILS;
    if (module) {
      // Leave no memberships behind for later specs to trip over.
      await clearSeededUsers();
      await module.close();
    }
  });

  async function clearSeededUsers(): Promise<void> {
    await queryDataSource.query(
      `DELETE FROM tenant_user WHERE tenant_id IN
         (SELECT id FROM tenant WHERE slug IN ('acme-corp', 'test-org', 'suspended-co'))`,
    );
  }

  async function countRows(table: string, where = 'TRUE'): Promise<number> {
    const rows = await queryDataSource.query<Array<{ count: string }>>(
      `SELECT COUNT(*)::text AS count FROM ${table} WHERE ${where}`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  it('seeds demo tenants and related data idempotently', async () => {
    const expectedOAuthClientIds = SEED_TENANTS.flatMap(({ slug }) => [
      seedApiClientId(slug),
      ...(slug === UI_SPA_TENANT_SLUG ? [UI_SPA_CLIENT_ID] : []),
    ]);
    const existingOAuthClients = await queryDataSource.query<
      Array<{ client_id: string }>
    >('SELECT client_id FROM oauth_client WHERE client_id = ANY($1)', [
      expectedOAuthClientIds,
    ]);
    const existingOAuthClientIds = new Set(
      existingOAuthClients.map(({ client_id }) => client_id),
    );
    const expectedCreatedOAuthClients = expectedOAuthClientIds.filter(
      (clientId) => !existingOAuthClientIds.has(clientId),
    );

    const first = await seedService.run();

    expect(first.tenants).toBe(3);
    expect(first.createdOAuthClients).toEqual(expectedCreatedOAuthClients);
    const seededOAuthClients = await queryDataSource.query<
      Array<{ client_id: string }>
    >('SELECT client_id FROM oauth_client WHERE client_id = ANY($1)', [
      expectedOAuthClientIds,
    ]);
    expect(
      new Set(seededOAuthClients.map(({ client_id }) => client_id)),
    ).toEqual(new Set(expectedOAuthClientIds));

    const tenantCount = await countRows(
      'tenant',
      "slug IN ('acme-corp', 'test-org', 'suspended-co')",
    );
    const userCount = await countRows(
      'tenant_user',
      "external_user_id LIKE 'dev-%'",
    );
    const oauthClientCount = await countRows(
      'oauth_client',
      "client_id LIKE 'dev-seed-%'",
    );

    expect(tenantCount).toBe(3);
    // Six placeholders; acme-corp's three users are invitations instead.
    expect(userCount).toBe(6);
    expect(
      await countRows(
        'tenant_user',
        "external_user_id IS NULL AND status = 'invited' AND email LIKE '%@acme-corp.example.test'",
      ),
    ).toBe(3);
    // The multi-tenant account is active in all three tenants from the start.
    const multiTenantWhere = `external_user_id = '${MULTI_TENANT_USER.externalUserId}' AND status = 'active'`;
    expect(await countRows('tenant_user', multiTenantWhere)).toBe(3);
    expect(oauthClientCount).toBe(3);

    const second = await seedService.run();

    expect(second.createdOAuthClients).toHaveLength(0);
    expect(
      await countRows(
        'tenant',
        "slug IN ('acme-corp', 'test-org', 'suspended-co')",
      ),
    ).toBe(tenantCount);
    expect(
      await countRows('tenant_user', "external_user_id LIKE 'dev-%'"),
    ).toBe(userCount);
    expect(await countRows('tenant_user', multiTenantWhere)).toBe(3);
    expect(await countRows('oauth_client', "client_id LIKE 'dev-seed-%'")).toBe(
      oauthClientCount,
    );
  });

  it('keeps a claimed invitation claimed across re-seeds', async () => {
    await seedService.run();
    const email = 'owner@acme-corp.example.test';

    try {
      // What the login callback does on first sign-in, plus a role change.
      await queryDataSource.query(
        `UPDATE tenant_user SET external_user_id = $1, status = 'active', role = 'readonly'
         WHERE email = $2`,
        ['keycloak-sub-1', email],
      );

      await expect(seedService.run()).resolves.toBeDefined();

      const rows = await queryDataSource.query<
        Array<{ external_user_id: string | null; status: string; role: string }>
      >(
        'SELECT external_user_id, status, role FROM tenant_user WHERE email = $1',
        [email],
      );
      expect(rows).toEqual([
        { external_user_id: 'keycloak-sub-1', status: 'active', role: 'owner' },
      ]);
    } finally {
      // Back to an unclaimed invitation, as later runs of this file expect.
      await queryDataSource.query(
        `UPDATE tenant_user SET external_user_id = NULL, status = 'invited' WHERE email = $1`,
        [email],
      );
    }
  });

  type OperatorRow = {
    email: string;
    display_name: string;
    role: string;
    status: string;
    external_user_id: string | null;
    is_platform_operator: boolean;
  };

  const operatorColumns =
    'email, display_name, role, status, external_user_id, is_platform_operator';

  it('seeds listed platform operators as invited owners, lowercased and idempotently', async () => {
    await seedService.run();
    await seedService.run();

    const rows = await queryDataSource.query<OperatorRow[]>(
      `SELECT ${operatorColumns} FROM tenant_user
        WHERE tenant_id = (SELECT id FROM tenant WHERE slug = $1)
          AND LOWER(email) IN ($2, $3)
        ORDER BY email`,
      [
        UI_SPA_TENANT_SLUG,
        'operator.one@example.test',
        'operator.two@example.test',
      ],
    );

    expect(rows).toEqual([
      {
        email: 'operator.one@example.test',
        display_name: 'operator.one@example.test',
        role: 'owner',
        status: 'invited',
        external_user_id: null,
        is_platform_operator: true,
      },
      {
        email: 'operator.two@example.test',
        display_name: 'operator.two@example.test',
        role: 'owner',
        status: 'invited',
        external_user_id: null,
        is_platform_operator: true,
      },
    ]);
  });

  it('promotes a row that signed in before being listed, keeping its name and subject', async () => {
    await seedService.run();
    const email = 'operator.two@example.test';

    try {
      // A readonly sign-in that landed before the email was listed, with the
      // email as the IdP spelled it.
      await queryDataSource.query(
        `UPDATE tenant_user
            SET external_user_id = $1, status = 'active', role = 'readonly',
                display_name = 'Real Name', is_platform_operator = false,
                email = 'Operator.Two@Example.test'
          WHERE email = $2`,
        ['keycloak-sub-op', email],
      );

      await seedService.run();

      const rows = await queryDataSource.query<OperatorRow[]>(
        `SELECT ${operatorColumns} FROM tenant_user WHERE LOWER(email) = $1`,
        [email],
      );
      expect(rows).toEqual([
        {
          email: 'Operator.Two@Example.test',
          display_name: 'Real Name',
          role: 'owner',
          status: 'active',
          external_user_id: 'keycloak-sub-op',
          is_platform_operator: true,
        },
      ]);
    } finally {
      await queryDataSource.query(
        `UPDATE tenant_user
            SET external_user_id = NULL, status = 'invited', display_name = $1, email = $1
          WHERE LOWER(email) = $1`,
        [email],
      );
    }
  });

  it('seeds the SPA client as public, with no secret', async () => {
    await seedService.run();

    const rows = await queryDataSource.query<
      Array<{
        is_public: boolean;
        client_secret_hash: string | null;
        redirect_uris: string[];
        post_logout_redirect_uris: string[];
      }>
    >(
      `SELECT is_public, client_secret_hash, redirect_uris, post_logout_redirect_uris
         FROM oauth_client WHERE client_id = $1`,
      [UI_SPA_CLIENT_ID],
    );

    expect(rows).toHaveLength(1);
    // The CHECK constraint is the only thing keeping the two kinds of client
    // from drifting into each other's shape, so pin both halves here.
    expect(rows[0]?.is_public).toBe(true);
    expect(rows[0]?.client_secret_hash).toBeNull();
    // Whatever APP_PUBLIC_URL this run has: the redirect URIs must sit on
    // its origin, or the provider rejects the SPA's callback in that
    // environment.
    const origin = uiSpaOrigin(
      module.get(OidcConfigService).getConfig().publicUrl,
    );
    expect(rows[0]?.redirect_uris).toEqual(uiSpaRedirectUris(origin));
    expect(rows[0]?.post_logout_redirect_uris).toEqual(
      uiSpaPostLogoutRedirectUris(origin),
    );
  });

  it('creates stable OAuth client ids per tenant slug', async () => {
    await seedService.run();

    for (const slug of ['acme-corp', 'test-org', 'suspended-co']) {
      const rows = await queryDataSource.query<Array<{ client_id: string }>>(
        `SELECT client_id FROM oauth_client WHERE client_id = $1`,
        [seedApiClientId(slug)],
      );
      expect(rows).toHaveLength(1);
    }
  });
});
