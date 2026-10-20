import { randomUUID } from 'crypto';

import { DataSource, QueryRunner } from 'typeorm';

import { CreateCredentialExchanges1792506949095 } from './migrations/000036_create-credential-exchanges';
import { buildSslConfig } from './ssl.util';

describe('credential exchange migration (integration)', () => {
  let db: DataSource;
  let runner: QueryRunner;
  const migration = new CreateCredentialExchanges1792506949095();
  const tenant = randomUUID();
  const foreignTenant = randomUUID();
  const connector = randomUUID();
  const connection = randomUUID();
  const foreignConnection = randomUUID();
  const offer = randomUUID();
  const pendingOffer = randomUUID();
  const foreignOffer = randomUUID();
  const completedCredential = randomUUID();
  const pendingCredential = randomUUID();

  beforeAll(async () => {
    db = await new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      entities: [],
      ssl: buildSslConfig(
        process.env.DB_SSL,
        process.env.DB_SSL_REJECT_UNAUTHORIZED,
        process.env.DB_SSL_CA,
      ),
    }).initialize();
  });

  beforeEach(async () => {
    runner = db.createQueryRunner();
    await runner.startTransaction();
    const schema = `exchange_migration_${randomUUID().replaceAll('-', '')}`;
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(`SET LOCAL search_path TO "${schema}", public`);
    await runner.query(`
      CREATE TABLE tenant (id uuid PRIMARY KEY);
      CREATE TABLE connector_credential (id uuid PRIMARY KEY, tenant_id uuid);
      CREATE TABLE connection (id uuid PRIMARY KEY, tenant_id uuid, protocol varchar(32));
      CREATE TABLE operation (id uuid PRIMARY KEY, tenant_id uuid, type varchar(64), request jsonb);
      CREATE TABLE credential (
        id uuid PRIMARY KEY, tenant_id uuid, connector_id uuid, connection_id uuid,
        operation_id uuid, state varchar(32), format varchar(32),
        external_id varchar(255), created_at timestamptz DEFAULT now()
      );
    `);
    await runner.query('INSERT INTO tenant VALUES ($1),($2)', [
      tenant,
      foreignTenant,
    ]);
    await runner.query('INSERT INTO connector_credential VALUES ($1,$2)', [
      connector,
      tenant,
    ]);
    await runner.query(
      "INSERT INTO connection VALUES ($1,$2,'didcomm-v1'),($3,$4,'didcomm-v1')",
      [connection, tenant, foreignConnection, foreignTenant],
    );
    await runner.query(
      "INSERT INTO operation VALUES ($1,$2,'credential.offer','{}'),($3,$4,'credential.offer','{}'),($5,$2,'credential.offer','{}')",
      [offer, tenant, foreignOffer, foreignTenant, pendingOffer],
    );
    const rows = [
      [completedCredential, connection, offer, 'issued', randomUUID()],
      [pendingCredential, connection, pendingOffer, 'offered', randomUUID()],
      [randomUUID(), null, offer, 'offered', null],
      [randomUUID(), foreignConnection, offer, 'offered', randomUUID()],
      [randomUUID(), connection, foreignOffer, 'offered', randomUUID()],
    ];
    for (const [id, connectionId, operationId, state, externalId] of rows) {
      await runner.query(
        `INSERT INTO credential
        (id,tenant_id,connector_id,connection_id,operation_id,state,format,external_id)
        VALUES ($1,$2,$3,$4,$5,$6,'anoncreds',$7)`,
        [id, tenant, connector, connectionId, operationId, state, externalId],
      );
    }
  });

  afterEach(async () => {
    await runner.rollbackTransaction();
    await runner.release();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('backfills only tenant-consistent offers and preserves original records', async () => {
    await migration.up(runner);
    const exchanges = await runner.manager.query<
      Array<{ id: string; state: string; issue_submission: string }>
    >(
      'SELECT id,state,issue_submission FROM credential_exchange ORDER BY state',
    );
    expect(exchanges).toEqual([
      {
        id: completedCredential,
        state: 'credential-issued',
        issue_submission: 'not-submitted',
      },
      {
        id: pendingCredential,
        state: 'offer-sent',
        issue_submission: 'not-submitted',
      },
    ]);
    const linked = await runner.manager.query<Array<{ id: string }>>(
      'SELECT id FROM credential WHERE exchange_id IS NOT NULL',
    );
    expect(linked.map((row) => row.id).sort()).toEqual(
      [completedCredential, pendingCredential].sort(),
    );
    expect(
      await runner.query('SELECT exchange_id FROM operation WHERE id=$1', [
        pendingOffer,
      ]),
    ).toEqual([{ exchange_id: pendingCredential }]);
    expect(await runner.query('SELECT id FROM credential')).toHaveLength(5);
    await migration.down(runner);
    expect(await runner.query('SELECT id FROM credential')).toHaveLength(5);
    const [{ exchange_table }] = await runner.manager.query<
      Array<{ exchange_table: string | null }>
    >(
      "SELECT to_regclass(current_schema() || '.credential_exchange') AS exchange_table",
    );
    expect(exchange_table).toBeNull();
  });
});
