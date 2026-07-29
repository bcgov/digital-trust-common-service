import type { EntityManager } from 'typeorm';

/**
 * Adapt a TypeORM EntityManager (including transactional managers) for pg-boss
 * ConnectionOptions.db / sendInTransaction.
 */
export function fromTypeOrm(manager: EntityManager): {
  executeSql: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: unknown[] }>;
} {
  return {
    async executeSql(text: string, values?: unknown[]) {
      const rows: unknown = await manager.query(text, values ?? []);
      return {
        rows: Array.isArray(rows) ? rows : [],
      };
    },
  };
}
