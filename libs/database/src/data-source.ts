import { DataSource } from 'typeorm';

import { InitialExtensions1783630501649 } from './migrations/000001_initial-extensions';
import { CreateTenantEntity1784231917556 } from './migrations/000002_create-tenant-entity';
import { CreateTenantUserEntity1784241747468 } from './migrations/000003_create-tenant-user-entity';
import { CreateCredentialDefinitionRegistry1784316680145 } from './migrations/000004_create-credential-definition-registry';
import { CreateConnectionState1784732194397 } from './migrations/000005_create-connection-state';
import { CreateOperationEntity1784242000000 } from './migrations/000006_create-operation-entity';
import { CreateAuditLogSchema1784901000002 } from './migrations/000007_create-audit-log-schema';
import { CreateOauthClient1785262142662 } from './migrations/000008_create-oauth-client';
import { CreateConnectorCredential1785262250704 } from './migrations/000009_create-connector-credential';
import { CreateIssuanceVerificationProfiles1785360000010 } from './migrations/000010_create-issuance-verification-profiles';
import { CreateCredentialRecord1785460000011 } from './migrations/000011_create-credential-record';
import { CreateOidcModel1785431598677 } from './migrations/000012_create-oidc-model';
import { CreateRoleScopes1785560000013 } from './migrations/000013_create-role-scopes';
import { CreateOidcUpstreamInteraction1786386020201 } from './migrations/000014_create-oidc-upstream-interactions';
import { AddOidcModelAccountId1786486033339 } from './migrations/000015_add-oidc-model-account-id';
import { AddOauthClientRefreshTokenTtl1786567439996 } from './migrations/000016_add-oauth-client-refresh-token-ttl';
import { BackfillOidcModelAccountId1786600000000 } from './migrations/000017_backfill-oidc-model-account-id';
import { CreateOidcUpstreamSession1786995277657 } from './migrations/000015_create-oidc-upstream-session';
import { buildSslConfig } from './ssl.util';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: ['dist/**/*.entity.js'],
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
    CreateOidcModel1785431598677,
    CreateRoleScopes1785560000013,
    CreateOidcUpstreamInteraction1786386020201,
    AddOidcModelAccountId1786486033339,
    AddOauthClientRefreshTokenTtl1786567439996,
    BackfillOidcModelAccountId1786600000000,
    CreateOidcUpstreamSession1786995277657,
  ],
  ssl: buildSslConfig(
    process.env.DB_SSL,
    process.env.DB_SSL_REJECT_UNAUTHORIZED,
    process.env.DB_SSL_CA,
  ),
});
