import {
  BackfillOidcModelAccountId1786600000000,
  migrationName,
} from './000017_backfill-oidc-model-account-id';

describe('BackfillOidcModelAccountId migration', () => {
  function createQueryRunner(batchSizes: number[]): {
    runner: { query: jest.Mock };
    queries: string[];
  } {
    const queries: string[] = [];
    let call = 0;

    return {
      queries,
      runner: {
        query: jest.fn((sql: string) => {
          queries.push(sql);
          const rows = new Array<number>(batchSizes[call] ?? 0).fill(1);
          call += 1;

          return Promise.resolve(rows);
        }),
      },
    };
  }

  it('exports a stable migration name', () => {
    expect(migrationName).toBe('BackfillOidcModelAccountId');
  });

  it('copies accountId out of the payload for rows missing the column', async () => {
    const { runner, queries } = createQueryRunner([0]);

    await new BackfillOidcModelAccountId1786600000000().up(runner as never);

    expect(queries[0]).toContain(`SET account_id = payload->>'accountId'`);
    expect(queries[0]).toContain('account_id IS NULL');
    expect(queries[0]).toContain(`payload->>'accountId' IS NOT NULL`);
  });

  it('bounds each statement to a batch rather than rewriting the table at once', async () => {
    const { runner, queries } = createQueryRunner([0]);

    await new BackfillOidcModelAccountId1786600000000().up(runner as never);

    expect(queries[0]).toContain('LIMIT $1');
    expect(runner.query).toHaveBeenCalledWith(expect.any(String), [10000]);
  });

  it('keeps batching until a pass updates nothing', async () => {
    const { runner } = createQueryRunner([10000, 10000, 42, 0]);

    await new BackfillOidcModelAccountId1786600000000().up(runner as never);

    expect(runner.query).toHaveBeenCalledTimes(4);
  });

  it('does not touch the schema on down', async () => {
    const { runner, queries } = createQueryRunner([]);

    await new BackfillOidcModelAccountId1786600000000().down();

    expect(queries).toHaveLength(0);
    expect(runner.query).not.toHaveBeenCalled();
  });
});
