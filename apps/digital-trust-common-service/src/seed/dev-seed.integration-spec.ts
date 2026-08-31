import { AppDataSource } from '@app/database/data-source';
import { buildSslConfig } from '@app/database/ssl.util';
import { OidcConfigModule, OidcConfigService } from '@app/oidc';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { EncryptionModule } from '../common/crypto/encryption.module';

import {
  UI_SPA_CLIENT_ID,
  seedApiClientId,
  uiSpaOrigin,
  uiSpaPostLogoutRedirectUris,
  uiSpaRedirectUris,
} from './dev-seed.data';
import { DevSeedService } from './dev-seed.service';
import { SEED_ENTITIES, SEED_REPOSITORY_PROVIDERS } from './seed.constants';

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
  });

  afterAll(async () => {
    if (module) {
      await module.close();
    }
  });

  async function countRows(table: string, where = 'TRUE'): Promise<number> {
    const rows = await queryDataSource.query<Array<{ count: string }>>(
      `SELECT COUNT(*)::text AS count FROM ${table} WHERE ${where}`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  it('seeds demo tenants and related data idempotently', async () => {
    const first = await seedService.run();

    expect(first.tenants).toBe(3);
    // Three per-tenant API clients plus the SPA's public client.
    expect(first.createdOAuthClients).toHaveLength(4);
    expect(first.createdOAuthClients).toContain(UI_SPA_CLIENT_ID);

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
    expect(userCount).toBe(9);
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
    expect(await countRows('oauth_client', "client_id LIKE 'dev-seed-%'")).toBe(
      oauthClientCount,
    );
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
    // Whatever OIDC_ISSUER this run has: the redirect URIs must sit on its
    // origin, or the provider rejects the SPA's callback in that environment.
    const origin = uiSpaOrigin(
      module.get(OidcConfigService).getConfig().issuer,
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
