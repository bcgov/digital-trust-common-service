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

  it('does not backfill, so nothing slow shares the ALTER TABLE lock', async () => {
    const { runner, queries } = createQueryRunner();

    await new AddOidcModelAccountId1786486033339().up(runner as never);

    // ADD COLUMN takes ACCESS EXCLUSIVE on oidc_model, held until the
    // migration commits. A row-rewriting backfill in the same transaction
    // turns that into an auth outage, so it lives in 000015 instead.
    expect(queries.some((query) => query.includes('UPDATE'))).toBe(false);
  });

  it('drops the index and column on down', async () => {
    const { runner, queries } = createQueryRunner();

    await new AddOidcModelAccountId1786486033339().down(runner as never);

    const joined = queries.join('\n');
    expect(joined).toContain('DROP INDEX IF EXISTS idx_oidc_model_account_id');
    expect(joined).toContain('DROP COLUMN IF EXISTS account_id');
  });
});
