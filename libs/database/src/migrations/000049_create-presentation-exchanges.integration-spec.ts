import { randomUUID } from 'crypto';

import { DataSource, QueryRunner } from 'typeorm';

import { CreatePresentationExchanges1795105834050 } from './000049_create-presentation-exchanges';

describe('Create presentation exchanges migration', () => {
  let dataSource: DataSource;
  let runner: QueryRunner;
  const schema = `presentation_exchange_${randomUUID().replace(/-/g, '')}`;
  const migration = new CreatePresentationExchanges1795105834050();

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });
    await dataSource.initialize();
    runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(`SET search_path TO "${schema}", public`);
    await runner.query(`
      CREATE TABLE tenant (id uuid PRIMARY KEY);
      CREATE TABLE connector_credential (
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenant(id)
      );
      CREATE TABLE connection (
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenant(id),
        connector_id uuid REFERENCES connector_credential(id),
        external_connection_id varchar(255), protocol varchar(32) NOT NULL
      );
      CREATE TABLE operation (
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenant(id),
        type varchar(255) NOT NULL, state varchar(32) NOT NULL,
        request jsonb NOT NULL, result jsonb, external_id varchar(255),
        created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
      );
    `);
  });

  afterAll(async () => {
    if (runner) {
      await runner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await runner.release();
    }
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('backfills only safely correlated requests and retains exchanges after operation deletion', async () => {
    const tenant = randomUUID();
    const otherTenant = randomUUID();
    const connector = randomUUID();
    const connection = randomUUID();
    const valid = randomUUID();
    const mismatched = randomUUID();
    await runner.query('INSERT INTO tenant(id) VALUES ($1), ($2)', [
      tenant,
      otherTenant,
    ]);
    await runner.query(
      'INSERT INTO connector_credential(id, tenant_id) VALUES ($1, $2)',
      [connector, tenant],
    );
    await runner.query(
      `INSERT INTO connection(id, tenant_id, connector_id, external_connection_id, protocol)
       VALUES ($1, $2, $3, 'backend-connection', 'didcomm-v1')`,
      [connection, tenant, connector],
    );
    const request = {
      body: {
        delivery: { connection_id: connection },
        snapshot: {
          connector_id: connector,
          options: { format: 'anoncreds' },
          proof_request: { connectionId: 'backend-connection' },
        },
      },
    };
    await runner.query(
      `INSERT INTO operation(id, tenant_id, type, state, request, external_id, created_at, updated_at)
       VALUES ($1, $3, 'presentation.request', 'processing', $5, 'backend-proof', now(), now()),
              ($2, $4, 'presentation.request', 'processing', $5, 'other-proof', now(), now())`,
      [valid, mismatched, tenant, otherTenant, JSON.stringify(request)],
    );
    await migration.up(runner);
    const rows = (await runner.query(
      'SELECT tenant_id, request_operation_id, external_id, state, submission FROM presentation_exchange',
    )) as Record<string, unknown>[];
    expect(rows).toEqual([
      {
        tenant_id: tenant,
        request_operation_id: valid,
        external_id: 'backend-proof',
        state: 'request-sent',
        submission: 'submitted',
      },
    ]);
    const operations = (await runner.query(
      'SELECT id, presentation_exchange_id FROM operation ORDER BY id',
    )) as { id: string; presentation_exchange_id: string | null }[];
    expect(
      operations.find((operation) => operation.id === valid)
        ?.presentation_exchange_id,
    ).toBeTruthy();
    expect(
      operations.find((operation) => operation.id === mismatched)
        ?.presentation_exchange_id,
    ).toBeNull();
    await runner.query('DELETE FROM operation WHERE id = $1', [valid]);
    expect(
      await runner.query(
        'SELECT request_operation_id FROM presentation_exchange',
      ),
    ).toEqual([{ request_operation_id: null }]);
    await migration.down(runner);
  });
});
