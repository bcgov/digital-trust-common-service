import type { EntityManager } from 'typeorm';

import { fromTypeOrm } from './from-typeorm';

describe('fromTypeOrm', () => {
  it('adapts EntityManager.query results to IDatabase.executeSql', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 1 }]);
    const manager = { query } as unknown as EntityManager;

    const db = fromTypeOrm(manager);
    const result = await db.executeSql('select 1', [1]);

    expect(query).toHaveBeenCalledWith('select 1', [1]);
    expect(result).toEqual({ rows: [{ id: 1 }] });
  });

  it('normalizes non-array query results to an empty rows array', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const manager = { query } as unknown as EntityManager;

    const db = fromTypeOrm(manager);
    const result = await db.executeSql('select 1');

    expect(result).toEqual({ rows: [] });
  });
});
