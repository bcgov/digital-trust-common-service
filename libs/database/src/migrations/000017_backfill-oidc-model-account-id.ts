import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'BackfillOidcModelAccountId';

/**
 * Backfills `oidc_model.account_id` from the JSONB payload.
 *
 * Split out of `000013` on purpose. There the backfill shared a transaction
 * with `ALTER TABLE ... ADD COLUMN`, so the ACCESS EXCLUSIVE lock that DDL
 * takes was held for the whole rewrite: measured at 11s for 300k rows on an
 * idle local instance. `oidc_model` is written by every token, session and
 * interaction request, and ACCESS EXCLUSIVE blocks reads too, so that window
 * is a hard auth outage rather than a slowdown.
 *
 * On its own the UPDATE takes only ROW EXCLUSIVE, which does not block
 * concurrent reads or writes, so the same work becomes invisible to callers.
 *
 * Batched by ctid to keep each statement's row count bounded. New rows do not
 * need this: the adapter has been writing `account_id` since `000013`, so this
 * only has to catch records already live at deploy time. Missing one is not a
 * correctness failure either, just a record invisible to the session cap and
 * to force-logout until it expires, but sessions outlive a deploy so it is
 * worth doing.
 */
export class BackfillOidcModelAccountId1786600000000 implements MigrationInterface {
  private static readonly BATCH_SIZE = 10000;

  public async up(queryRunner: QueryRunner): Promise<void> {
    let updated = 0;

    do {
      // TypeORM's Postgres driver returns [rows, rowCount] for UPDATE, so the
      // count comes from index 1. RETURNING would not help: the array is two
      // elements wide whatever the statement affected.
      const result = (await queryRunner.query(
        `WITH batch AS (
          SELECT ctid FROM oidc_model
           WHERE account_id IS NULL
             AND payload->>'accountId' IS NOT NULL
           LIMIT $1
        )
        UPDATE oidc_model
           SET account_id = payload->>'accountId'
          WHERE ctid IN (SELECT ctid FROM batch)`,
        [BackfillOidcModelAccountId1786600000000.BATCH_SIZE],
      )) as [unknown[], number] | undefined;

      updated = result?.[1] ?? 0;
    } while (updated > 0);
  }

  public async down(): Promise<void> {
    // No-op. The column and its index are owned by 000013, and clearing the
    // values would only discard data that is still recoverable from payload.
  }
}
