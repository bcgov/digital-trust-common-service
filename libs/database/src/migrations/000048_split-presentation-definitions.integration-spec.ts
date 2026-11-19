import { randomUUID } from 'crypto';

import { DataSource, QueryRunner } from 'typeorm';

import { SplitPresentationDefinitions1795105099183 } from './000048_split-presentation-definitions';

describe('Split presentation definitions migration', () => {
  let dataSource: DataSource;
  let runner: QueryRunner;
  const schema = `presentation_split_${randomUUID().replace(/-/g, '')}`;
  const migration = new SplitPresentationDefinitions1795105099183();

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
      CREATE TYPE verification_profile_status AS ENUM (
        'draft', 'published', 'deprecated'
      );
      CREATE TABLE verification_profile (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        name varchar(100) NOT NULL,
        version varchar(20) NOT NULL,
        description text,
        presentation_definition jsonb NOT NULL,
        requested_attributes text[],
        predicates jsonb,
        presentation_format varchar(50),
        status verification_profile_status NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        UNIQUE (tenant_id, name, version)
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

  it('backfills one tenant-scoped definition per profile and retains IDs', async () => {
    const tenant = randomUUID();
    const otherTenant = randomUUID();
    const first = randomUUID();
    const second = randomUUID();
    const third = randomUUID();
    await runner.query('INSERT INTO tenant(id) VALUES ($1), ($2)', [
      tenant,
      otherTenant,
    ]);
    await runner.query(
      `INSERT INTO verification_profile
        (id, tenant_id, name, version, presentation_definition,
         requested_attributes, predicates, presentation_format, status,
         created_at, updated_at)
       VALUES
        ($1, $4, 'one', '1', '{"id":"proof-one"}', ARRAY['name'],
         '[{"attribute":"age"}]', 'anoncreds', 'published', now(), now()),
        ($2, $4, 'two', '1', '{"id":"proof-two"}', NULL,
         NULL, NULL, 'draft', now(), now()),
        ($3, $5, 'one', '1', '{"id":"other"}', NULL,
         NULL, NULL, 'deprecated', now(), now())`,
      [first, second, third, tenant, otherTenant],
    );

    await migration.up(runner);
    const rows = (await runner.query(`
      SELECT p.id, p.tenant_id, p.presentation_definition_id, d.status,
             d.presentation_definition, d.requested_attributes, d.predicates,
             d.presentation_format
      FROM verification_profile p
      JOIN presentation_definition d
        ON d.id = p.presentation_definition_id AND d.tenant_id = p.tenant_id
      ORDER BY p.name, p.tenant_id
    `)) as Array<{
      id: string;
      tenant_id: string;
      presentation_definition_id: string;
      status: string;
      presentation_definition: Record<string, unknown>;
      requested_attributes: string[] | null;
      predicates: unknown;
      presentation_format: string | null;
    }>;
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.id === row.presentation_definition_id)).toBe(
      true,
    );
    expect(rows.find((row) => row.id === first)).toMatchObject({
      tenant_id: tenant,
      status: 'published',
      presentation_definition: { id: 'proof-one' },
      requested_attributes: ['name'],
      predicates: [{ attribute: 'age' }],
      presentation_format: 'anoncreds',
    });
    await expect(
      runner.query(
        'UPDATE verification_profile SET presentation_definition_id = $1 WHERE id = $2',
        [third, first],
      ),
    ).rejects.toThrow();

    await runner.query('DELETE FROM tenant WHERE id = $1', [otherTenant]);
    expect(
      await runner.query(
        'SELECT id FROM presentation_definition WHERE id = $1',
        [third],
      ),
    ).toEqual([]);
    await migration.down(runner);
    const profiles = (await runner.query(
      'SELECT id FROM verification_profile ORDER BY id',
    )) as { id: string }[];
    expect(profiles.map((profile) => profile.id).sort()).toEqual(
      [first, second].sort(),
    );
  });
});
