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
          const affected = batchSizes[call] ?? 0;
          call += 1;

          // TypeORM's Postgres driver returns [rows, rowCount] for UPDATE.
          // The outer array is always length 2, so a loop that counts it
          // instead of reading index 1 never terminates.
          return Promise.resolve([
            new Array<number>(affected).fill(1),
            affected,
          ]);
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

  it('stops on the first pass when there is nothing to backfill', async () => {
    // Guards the loop condition. Reading the length of TypeORM's [rows, count]
    // result instead of the count never reaches zero, so this would hang.
    const { runner } = createQueryRunner([0]);

    await new BackfillOidcModelAccountId1786600000000().up(runner as never);

    expect(runner.query).toHaveBeenCalledTimes(1);
  });

  it('does not touch the schema on down', async () => {
    const { runner, queries } = createQueryRunner([]);

    await new BackfillOidcModelAccountId1786600000000().down();

    expect(queries).toHaveLength(0);
    expect(runner.query).not.toHaveBeenCalled();
  });
});
