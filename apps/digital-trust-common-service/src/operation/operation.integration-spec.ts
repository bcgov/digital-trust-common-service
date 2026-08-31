import { AppDataSource } from '@app/database/data-source';
import { buildSslConfig } from '@app/database/ssl.util';
import { DataSource } from 'typeorm';

import { SEED_ENTITIES } from '../seed/seed.constants';

import { Operation, OperationState } from './operation.entity';
import { OperationRepository } from './operation.repository';

/**
 * Tenant isolation for the polling endpoint at the SQL layer: the
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
    // The real migration list and the shared entity set, not hand-maintained
    // copies: Operation relates to Tenant, which relates on to TenantUser, so a
    // partial entity list fails metadata build, and a partial migration list
    // only passes when a sibling spec happens to have migrated further first.
    dataSource = new DataSource({
      ...AppDataSource.options,
      entities: [...SEED_ENTITIES],
      ssl: buildSslConfig(
        process.env.DB_SSL,
        process.env.DB_SSL_REJECT_UNAUTHORIZED,
        process.env.DB_SSL_CA,
      ),
    } as DataSource['options']);

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
      // Operation first: its tenant FK is onDelete RESTRICT, and the rows would
      // otherwise accumulate in the shared test database on every run.
      await dataSource.query(
        `DELETE FROM operation WHERE tenant_id = ANY($1)`,
        [[tenantAId, tenantBId]],
      );
      await dataSource.query(`DELETE FROM tenant WHERE id = ANY($1)`, [
        [tenantAId, tenantBId],
      ]);

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

  it('stamps the first view once, without moving updated_at', async () => {
    // Against the real driver: query() returns [rows, rowCount] for a bare
    // UPDATE, so the CTE shape is load-bearing and a mocked row array cannot
    // prove it. Also pins the single-shot guard and the untouched updated_at.
    const [before] = await dataSource.query<Array<{ updated_at: Date }>>(
      `SELECT updated_at FROM operation WHERE id = $1`,
      [tenantAOperationId],
    );

    const viewedAt = new Date();
    const expiresAt = new Date(viewedAt.getTime() + 60 * 60 * 1000);

    const first = await repository.markFirstView(
      tenantAOperationId,
      viewedAt,
      expiresAt,
    );
    const second = await repository.markFirstView(
      tenantAOperationId,
      new Date(viewedAt.getTime() + 60_000),
      new Date(expiresAt.getTime() + 60_000),
    );

    expect(first?.viewedAt).toBeInstanceOf(Date);
    expect(first?.expiresAt.getTime()).toBe(expiresAt.getTime());
    expect(second).toBeNull();

    const [after] = await dataSource.query<Array<{ updated_at: Date }>>(
      `SELECT updated_at FROM operation WHERE id = $1`,
      [tenantAOperationId],
    );

    expect(after.updated_at.getTime()).toBe(before.updated_at.getTime());
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
