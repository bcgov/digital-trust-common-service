import { randomUUID } from 'node:crypto';

import { DataSource, QueryRunner } from 'typeorm';

import { ConfigureIssuanceProfileClaims1794328787660 } from './000044_configure-issuance-profile-claims';

describe('issuance profile claims migration', () => {
  const schema = `profile_claims_${randomUUID().replaceAll('-', '')}`;
  const source = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    synchronize: false,
  });
  let runner: QueryRunner;
  const migration = new ConfigureIssuanceProfileClaims1794328787660();

  beforeAll(async () => {
    await source.initialize();
    runner = source.createQueryRunner();
    await runner.connect();
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(`SET search_path TO "${schema}"`);
  });

  beforeEach(async () => {
    await runner.query('DROP TABLE IF EXISTS issuance_profile');
    await runner.query('DROP TABLE IF EXISTS credential_definition');
    await runner.query(`CREATE TABLE credential_definition (
      id INTEGER PRIMARY KEY,
      schema_definition JSONB NOT NULL
    )`);
    await runner.query(`CREATE TABLE issuance_profile (
      id INTEGER PRIMARY KEY,
      credential_definition_id INTEGER NOT NULL,
      attribute_schema JSONB NOT NULL,
      defaults JSONB,
      protocol_hint TEXT NOT NULL DEFAULT 'auto'
    )`);
  });

  afterAll(async () => {
    if (runner) {
      try {
        await runner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await runner.release();
      }
    }
    if (source.isInitialized) await source.destroy();
  });

  it('moves optional definition attributes to profile requiredness and discards defaults', async () => {
    await runner.query(`INSERT INTO credential_definition VALUES
      (1, '{"attr_names":["given_name","family_name","nickname"],"optional_attributes":["nickname"]}'),
      (2, '{}')`);
    await runner.query(`INSERT INTO issuance_profile VALUES
      (1, 1, '{"name":{"type":"string","required":true}}', '{"a/b":"CA"}', 'auto'),
      (2, 2, '{"name":{"type":"string","required":true}}', NULL, 'didcomm')`);

    await migration.up(runner);
    const rows: unknown = await runner.query(
      'SELECT claims, delivery FROM issuance_profile ORDER BY id',
    );
    expect(rows).toEqual([
      {
        claims: { required: ['family_name', 'given_name', 'name'] },
        delivery: { protocol: 'didcomm-v1' },
      },
      {
        claims: { required: ['name'] },
        delivery: { protocol: 'didcomm-v1' },
      },
    ]);

    await migration.down(runner);
    const legacy: unknown = await runner.query(
      'SELECT attribute_schema, defaults, protocol_hint FROM issuance_profile WHERE id = 1',
    );
    expect(legacy).toEqual([
      {
        attribute_schema: { name: { type: 'string', required: true } },
        defaults: { 'a/b': 'CA' },
        protocol_hint: 'auto',
      },
    ]);
  });

  it('refuses to reinterpret an unsupported protocol', async () => {
    await runner.query("INSERT INTO credential_definition VALUES (1, '{}')");
    await runner.query(
      `INSERT INTO issuance_profile VALUES (1, 1, '{}', NULL, 'oid4vci')`,
    );
    await expect(migration.up(runner)).rejects.toThrow(
      'explicit delivery migration',
    );
    const columns: unknown = await runner.query(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
      [schema, 'issuance_profile'],
    );
    expect(columns).not.toEqual(
      expect.arrayContaining([{ column_name: 'delivery' }]),
    );
  });
});
