import { randomUUID } from 'crypto';

import { DataSource, QueryRunner } from 'typeorm';

import { SplitPresentationDefinitions1795600000000 } from './000048_split-presentation-definitions';

describe('Split presentation definitions migration', () => {
  let dataSource: DataSource;
  let runner: QueryRunner;
  const schema = `presentation_split_${randomUUID().replace(/-/g, '')}`;
  const migration = new SplitPresentationDefinitions1795600000000();

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
      CREATE TABLE tenant (id uuid PRIMARY KEY);
      CREATE TYPE verification_profile_status AS ENUM ('draft', 'published', 'deprecated');
      CREATE TABLE verification_profile (
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        name varchar(100) NOT NULL, version varchar(20) NOT NULL, description text,
        presentation_definition jsonb NOT NULL, requested_attributes text[], predicates jsonb,
        status verification_profile_status NOT NULL, created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL, UNIQUE (tenant_id, name, version)
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

  it('preserves profile identity and evidence, enforces tenant linkage, and reverses', async () => {
    const tenant = randomUUID();
    const other = randomUUID();
    const profile = randomUUID();
    const otherProfile = randomUUID();
    await runner.query('INSERT INTO tenant(id) VALUES ($1), ($2)', [
      tenant,
      other,
    ]);
    await runner.query(
      `
      INSERT INTO verification_profile
        (id, tenant_id, name, version, presentation_definition, requested_attributes,
         predicates, status, created_at, updated_at)
      VALUES
        ($1, $2, 'identity', '1', '{"id":"proof"}', ARRAY['name'],
         '[{"attribute":"age","condition":">=","value":"18"}]', 'published', now(), now()),
        ($3, $4, 'identity', '1', '{"id":"other"}', NULL, NULL, 'draft', now(), now())
    `,
      [profile, tenant, otherProfile, other],
    );
    await migration.up(runner);
    const [row] = (await runner.query(
      `
      SELECT p.id, p.presentation_definition_id, p.delivery, d.status,
        d.presentation_definition, d.requested_attributes, d.predicates, d.presentation_format
      FROM verification_profile p JOIN presentation_definition d
        ON d.tenant_id = p.tenant_id AND d.id = p.presentation_definition_id
      WHERE p.id = $1
    `,
      [profile],
    )) as Record<string, unknown>[];
    expect(row).toMatchObject({
      id: profile,
      presentation_definition_id: profile,
      delivery: null,
      status: 'published',
      presentation_definition: { id: 'proof' },
      requested_attributes: ['name'],
      predicates: [{ attribute: 'age', condition: '>=', value: '18' }],
      presentation_format: null,
    });
    await expect(
      runner.query(
        'UPDATE verification_profile SET presentation_definition_id = $1 WHERE id = $2',
        [otherProfile, profile],
      ),
    ).rejects.toThrow();
    await migration.down(runner);
    const [restored] = (await runner.query(
      'SELECT id, presentation_definition, requested_attributes, predicates FROM verification_profile WHERE id = $1',
      [profile],
    )) as Record<string, unknown>[];
    expect(restored).toMatchObject({
      id: profile,
      presentation_definition: { id: 'proof' },
      requested_attributes: ['name'],
      predicates: [{ attribute: 'age', condition: '>=', value: '18' }],
    });
  });
});
