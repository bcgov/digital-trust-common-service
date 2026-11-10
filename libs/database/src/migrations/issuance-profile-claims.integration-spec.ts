import { randomUUID } from 'node:crypto';

import { DataSource, QueryRunner } from 'typeorm';

import { ConfigureIssuanceProfileClaims1794328787660 } from './000044_configure-issuance-profile-claims';

describe('issuance profile claim configuration migration', () => {
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
    await runner.query(`CREATE TABLE issuance_profile (
      id INTEGER PRIMARY KEY,
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

  it('backfills defaults with escaped pointers and preserves legacy configuration for rollback', async () => {
    await runner.query(`INSERT INTO issuance_profile VALUES
      (1, '{"name":{"type":"string","required":true}}', '{"a/b":"CA","~name":null}', 'auto'),
      (2, '{}', NULL, 'didcomm')`);
    await migration.up(runner);
    const rows: unknown = await runner.query(
      'SELECT claim_constraints, delivery FROM issuance_profile ORDER BY id',
    );
    expect(rows).toEqual([
      {
        claim_constraints: {
          '/a~1b': { default: 'CA' },
          '/~0name': { default: null },
        },
        delivery: { protocol: 'didcomm-v1' },
      },
      { claim_constraints: {}, delivery: { protocol: 'didcomm-v1' } },
    ]);
    await runner.query(`INSERT INTO issuance_profile (id, delivery)
      VALUES (3, '{"protocol":"didcomm-v1"}')`);
    await expect(
      runner.query(`INSERT INTO issuance_profile (id) VALUES (4)`),
    ).rejects.toThrow();
    await migration.down(runner);
    const legacy: unknown = await runner.query(
      'SELECT attribute_schema, defaults, protocol_hint FROM issuance_profile WHERE id = 1',
    );
    expect(legacy).toEqual([
      {
        attribute_schema: { name: { type: 'string', required: true } },
        defaults: { 'a/b': 'CA', '~name': null },
        protocol_hint: 'auto',
      },
    ]);
  });

  it('refuses to reinterpret an unsupported protocol', async () => {
    await runner.query(
      `INSERT INTO issuance_profile VALUES (1, '{}', NULL, 'oid4vci')`,
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
