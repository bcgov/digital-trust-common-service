import { randomUUID } from 'crypto';

import { DataSource, QueryRunner } from 'typeorm';

import { RemoveVerificationProtocolHint1795700000000 } from './000050_remove-verification-protocol-hint';

describe('Remove verification protocol hint migration', () => {
  let dataSource: DataSource;
  let runner: QueryRunner;
  const schema = `verification_delivery_${randomUUID().replace(/-/g, '')}`;
  const migration = new RemoveVerificationProtocolHint1795700000000();

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
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(`SET search_path TO "${schema}", public`);
    await runner.query(`
      CREATE TYPE verification_profile_protocol_hint AS ENUM ('auto', 'didcomm', 'oid4vp');
      CREATE TABLE verification_profile (
        id uuid PRIMARY KEY,
        protocol_hint verification_profile_protocol_hint NOT NULL DEFAULT 'auto',
        delivery jsonb
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

  it('preserves legacy inference, explicit delivery and exact hints on rollback', async () => {
    const ids = Array.from({ length: 6 }, () => randomUUID());
    await runner.query(
      `INSERT INTO verification_profile (id, protocol_hint, delivery) VALUES
        ($1, 'auto', NULL), ($2, 'didcomm', NULL), ($3, 'oid4vp', NULL),
        ($4, 'didcomm', '{"protocol":"didcomm-v1"}'),
        ($5, 'oid4vp', '{"protocol":"oid4vp"}'), ($6, 'oid4vp', NULL)`,
      ids,
    );
    await migration.up(runner);
    const rows = (await runner.query(
      'SELECT id, delivery FROM verification_profile',
    )) as { id: string; delivery: { protocol: string } | null }[];
    expect(rows.find((row) => row.id === ids[0])?.delivery).toBeNull();
    expect(rows.find((row) => row.id === ids[1])?.delivery).toBeNull();
    expect(rows.find((row) => row.id === ids[2])?.delivery).toEqual({
      protocol: 'oid4vp',
    });
    expect(rows.find((row) => row.id === ids[3])?.delivery).toEqual({
      protocol: 'didcomm-v1',
    });
    expect(rows.find((row) => row.id === ids[4])?.delivery).toEqual({
      protocol: 'oid4vp',
    });

    const newId = randomUUID();
    await runner.query(
      `INSERT INTO verification_profile (id, delivery)
       VALUES ($1, '{"protocol":"didcomm-v1"}')`,
      [newId],
    );
    await runner.query(
      `UPDATE verification_profile SET delivery = '{"protocol":"didcomm-v1"}'
       WHERE id = $1`,
      [ids[5]],
    );
    await migration.down(runner);
    const restored = (await runner.query(
      'SELECT id, protocol_hint, delivery FROM verification_profile',
    )) as {
      id: string;
      protocol_hint: string;
      delivery: { protocol: string } | null;
    }[];
    expect(
      ids.map((id) => restored.find((row) => row.id === id)?.protocol_hint),
    ).toEqual(['auto', 'didcomm', 'oid4vp', 'didcomm', 'oid4vp', 'oid4vp']);
    expect(restored.find((row) => row.id === ids[2])?.delivery).toBeNull();
    expect(restored.find((row) => row.id === ids[4])?.delivery).toEqual({
      protocol: 'oid4vp',
    });
    expect(restored.find((row) => row.id === ids[5])?.delivery).toEqual({
      protocol: 'didcomm-v1',
    });
    expect(restored.find((row) => row.id === newId)?.protocol_hint).toBe(
      'auto',
    );
  });

  it('rejects conflicting OID4VP hints and delivery without modifying the schema', async () => {
    const id = randomUUID();
    await runner.query(
      `INSERT INTO verification_profile (id, protocol_hint, delivery)
       VALUES ($1, 'oid4vp', '{"protocol":"didcomm-v1"}')`,
      [id],
    );
    await expect(migration.up(runner)).rejects.toThrow(
      'OID4VP verification profiles with conflicting delivery require explicit migration',
    );
    const [row] = (await runner.query(
      'SELECT protocol_hint, delivery FROM verification_profile WHERE id = $1',
      [id],
    )) as { protocol_hint: string; delivery: { protocol: string } }[];
    expect(row).toEqual({
      protocol_hint: 'oid4vp',
      delivery: { protocol: 'didcomm-v1' },
    });
  });
});
