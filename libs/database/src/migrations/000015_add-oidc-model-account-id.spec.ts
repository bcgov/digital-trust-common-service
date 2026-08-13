import {
  AddOidcModelAccountId1786486033339,
  migrationName,
} from './000015_add-oidc-model-account-id';

describe('AddOidcModelAccountId migration', () => {
  function createQueryRunner(): {
    runner: { query: jest.Mock };
    queries: string[];
  } {
    const queries: string[] = [];

    return {
      queries,
      runner: {
        query: jest.fn((sql: string) => {
          queries.push(sql);
          return Promise.resolve();
        }),
      },
    };
  }

  it('exports a stable migration name', () => {
    expect(migrationName).toBe('AddOidcModelAccountId');
  });

  it('adds a nullable account_id column with a partial index', async () => {
    const { runner, queries } = createQueryRunner();

    await new AddOidcModelAccountId1786486033339().up(runner as never);

    const joined = queries.join('\n');
    expect(joined).toContain('ALTER TABLE oidc_model');
    expect(joined).toContain('ADD COLUMN account_id VARCHAR(255)');
    expect(joined).toContain('CREATE INDEX idx_oidc_model_account_id');
    expect(joined).toContain('ON oidc_model (model_name, account_id)');
    expect(joined).toContain('WHERE account_id IS NOT NULL');
  });

  it('backfills account_id from the existing JSONB payload', async () => {
    const { runner, queries } = createQueryRunner();

    await new AddOidcModelAccountId1786486033339().up(runner as never);

    const backfill = queries.find((query) => query.includes('UPDATE'));
    expect(backfill).toContain(`SET account_id = payload->>'accountId'`);
    expect(backfill).toContain(`WHERE payload->>'accountId' IS NOT NULL`);
  });

  it('backfills before creating the index so the index is built once', async () => {
    const { runner, queries } = createQueryRunner();

    await new AddOidcModelAccountId1786486033339().up(runner as never);

    const backfillIndex = queries.findIndex((query) =>
      query.includes('UPDATE'),
    );
    const createIndexIndex = queries.findIndex((query) =>
      query.includes('CREATE INDEX'),
    );

    expect(backfillIndex).toBeGreaterThanOrEqual(0);
    expect(createIndexIndex).toBeGreaterThan(backfillIndex);
  });

  it('drops the index and column on down', async () => {
    const { runner, queries } = createQueryRunner();

    await new AddOidcModelAccountId1786486033339().down(runner as never);

    const joined = queries.join('\n');
    expect(joined).toContain('DROP INDEX IF EXISTS idx_oidc_model_account_id');
    expect(joined).toContain('DROP COLUMN IF EXISTS account_id');
  });
});
