import {
  AddOauthClientRefreshTokenTtl1786567439996,
  migrationName,
} from './000016_add-oauth-client-refresh-token-ttl';

describe('AddOauthClientRefreshTokenTtl migration', () => {
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
    expect(migrationName).toBe('AddOauthClientRefreshTokenTtl');
  });

  it('adds a nullable refresh_token_ttl_seconds column', async () => {
    const { runner, queries } = createQueryRunner();

    await new AddOauthClientRefreshTokenTtl1786567439996().up(runner as never);

    const joined = queries.join('\n');
    expect(joined).toContain('ALTER TABLE oauth_client');
    expect(joined).toContain('ADD COLUMN refresh_token_ttl_seconds INTEGER');
    // Nullable is load-bearing: NULL means "inherit the server default", so
    // the column must not be declared NOT NULL or given a DEFAULT.
    expect(joined).not.toContain('NOT NULL');
    expect(joined).not.toContain('DEFAULT');
  });

  it('rejects a non-positive TTL via a check constraint', async () => {
    const { runner, queries } = createQueryRunner();

    await new AddOauthClientRefreshTokenTtl1786567439996().up(runner as never);

    const joined = queries.join('\n');
    expect(joined).toContain('chk_oauth_client_refresh_token_ttl_positive');
    expect(joined).toContain(
      'CHECK (refresh_token_ttl_seconds IS NULL OR refresh_token_ttl_seconds > 0)',
    );
  });

  it('drops the constraint before the column on revert', async () => {
    const { runner, queries } = createQueryRunner();

    await new AddOauthClientRefreshTokenTtl1786567439996().down(
      runner as never,
    );

    const constraintIndex = queries.findIndex((sql) =>
      sql.includes('DROP CONSTRAINT'),
    );
    const columnIndex = queries.findIndex((sql) => sql.includes('DROP COLUMN'));

    expect(constraintIndex).toBeGreaterThanOrEqual(0);
    expect(columnIndex).toBeGreaterThan(constraintIndex);
  });

  it('is idempotent on revert', async () => {
    const { runner, queries } = createQueryRunner();

    await new AddOauthClientRefreshTokenTtl1786567439996().down(
      runner as never,
    );

    const joined = queries.join('\n');
    expect(joined).toContain('DROP CONSTRAINT IF EXISTS');
    expect(joined).toContain('DROP COLUMN IF EXISTS');
  });
});
