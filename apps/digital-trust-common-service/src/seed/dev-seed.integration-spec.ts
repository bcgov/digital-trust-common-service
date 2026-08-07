import { InitialExtensions1783630501649 } from '@app/database/migrations/000001_initial-extensions';
import { CreateTenantEntity1784231917556 } from '@app/database/migrations/000002_create-tenant-entity';
import { CreateTenantUserEntity1784241747468 } from '@app/database/migrations/000003_create-tenant-user-entity';
import { CreateCredentialDefinitionRegistry1784316680145 } from '@app/database/migrations/000004_create-credential-definition-registry';
import { CreateConnectionState1784732194397 } from '@app/database/migrations/000005_create-connection-state';
import { CreateOperationEntity1784242000000 } from '@app/database/migrations/000006_create-operation-entity';
import { CreateAuditLogSchema1784901000002 } from '@app/database/migrations/000007_create-audit-log-schema';
import { CreateOauthClient1785262142662 } from '@app/database/migrations/000008_create-oauth-client';
import { CreateConnectorCredential1785262250704 } from '@app/database/migrations/000009_create-connector-credential';
import { CreateIssuanceVerificationProfiles1785360000010 } from '@app/database/migrations/000010_create-issuance-verification-profiles';
import { CreateCredentialRecord1785460000011 } from '@app/database/migrations/000011_create-credential-record';
import { buildSslConfig } from '@app/database/ssl.util';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { EncryptionModule } from '../common/crypto/encryption.module';

import { seedApiClientId } from './dev-seed.data';
import { DevSeedService } from './dev-seed.service';
import { SEED_ENTITIES, SEED_REPOSITORY_PROVIDERS } from './seed.constants';

describe('DevSeedService integration', () => {
  let module: TestingModule;
  let migrationDataSource: DataSource;
  let queryDataSource: DataSource;
  let seedService: DevSeedService;

  beforeAll(async () => {
    migrationDataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      entities: [],
      migrations: [
        InitialExtensions1783630501649,
        CreateTenantEntity1784231917556,
        CreateTenantUserEntity1784241747468,
        CreateCredentialDefinitionRegistry1784316680145,
        CreateConnectionState1784732194397,
        CreateOperationEntity1784242000000,
        CreateAuditLogSchema1784901000002,
        CreateOauthClient1785262142662,
        CreateConnectorCredential1785262250704,
        CreateIssuanceVerificationProfiles1785360000010,
        CreateCredentialRecord1785460000011,
      ],
      ssl: buildSslConfig(
        process.env.DB_SSL,
        process.env.DB_SSL_REJECT_UNAUTHORIZED,
        process.env.DB_SSL_CA,
      ),
    });

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
    expect(first.createdOAuthClients).toHaveLength(3);

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
