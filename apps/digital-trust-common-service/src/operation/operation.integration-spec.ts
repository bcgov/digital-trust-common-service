import { InitialExtensions1783630501649 } from '@app/database/migrations/000001_initial-extensions';
import { CreateTenantEntity1784231917556 } from '@app/database/migrations/000002_create-tenant-entity';
import { CreateTenantUserEntity1784241747468 } from '@app/database/migrations/000003_create-tenant-user-entity';
import { CreateCredentialDefinitionRegistry1784316680145 } from '@app/database/migrations/000004_create-credential-definition-registry';
import { CreateConnectionState1784732194397 } from '@app/database/migrations/000005_create-connection-state';
import { CreateOperationEntity1784242000000 } from '@app/database/migrations/000006_create-operation-entity';
import { buildSslConfig } from '@app/database/ssl.util';
import { DataSource } from 'typeorm';

import { Tenant } from '../tenant/tenant.entity';

import { Operation, OperationState } from './operation.entity';
import { OperationRepository } from './operation.repository';

/**
 * Tenant isolation for the polling endpoint (AG-02.1) at the SQL layer: the
 * repository filter is what turns another tenant's operation id into a 404.
 * Guard-level claim-match (403) is covered by jwt-guard.integration-spec.ts.
 */
describe('operation tenant isolation integration', () => {
  let dataSource: DataSource;
  let repository: OperationRepository;
  let tenantAId: string;
  let tenantBId: string;
  let tenantAOperationId: string;

  const insertTenant = async (label: string): Promise<string> => {
    const rows = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO tenant (name, slug, status)
       VALUES ($1, $2, 'active')
       RETURNING id`,
      [`Operation Integration ${label}`, `operation-it-${label}-${Date.now()}`],
    );

    return rows[0].id;
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      entities: [Operation, Tenant],
      migrations: [
        InitialExtensions1783630501649,
        CreateTenantEntity1784231917556,
        CreateTenantUserEntity1784241747468,
        CreateCredentialDefinitionRegistry1784316680145,
        CreateConnectionState1784732194397,
        CreateOperationEntity1784242000000,
      ],
      ssl: buildSslConfig(
        process.env.DB_SSL,
        process.env.DB_SSL_REJECT_UNAUTHORIZED,
        process.env.DB_SSL_CA,
      ),
    });

    await dataSource.initialize();
    await dataSource.runMigrations();

    repository = new OperationRepository(dataSource.getRepository(Operation));

    tenantAId = await insertTenant('a');
    tenantBId = await insertTenant('b');

    const operations = await dataSource.query<Array<{ id: string }>>(
      `INSERT INTO operation (
         tenant_id, type, state, request, expires_at
       ) VALUES (
         $1,
         'credential.offer',
         'completed',
         '{"method":"POST","path":"/x","body":{"given_name":"Alice"}}'::jsonb,
         NOW() + INTERVAL '72 hours'
       )
       RETURNING id`,
      [tenantAId],
    );
    tenantAOperationId = operations[0].id;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('returns the operation for its owning tenant', async () => {
    const operation = await repository.findByIdForTenant(
      tenantAOperationId,
      tenantAId,
    );

    expect(operation?.id).toBe(tenantAOperationId);
    expect(operation?.state).toBe(OperationState.COMPLETED);
  });

  it('returns null for another tenant, indistinguishable from a missing row', async () => {
    const foreign = await repository.findByIdForTenant(
      tenantAOperationId,
      tenantBId,
    );
    const missing = await repository.findByIdForTenant(
      '123e4567-e89b-12d3-a456-426614174000',
      tenantBId,
    );

    expect(foreign).toBeNull();
    expect(missing).toBeNull();
  });
});
