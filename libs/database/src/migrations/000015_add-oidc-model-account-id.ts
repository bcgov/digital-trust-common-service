import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'AddOidcModelAccountId';

/**
 * Adds a promoted `account_id` lookup column to `oidc_model`.
 *
 * `000012` indexed only the lookup keys oidc-provider's adapter interface
 * itself needs (`grant_id`, `user_code`, `uid`). AU-08 (#41) additionally
 * needs to answer "which records belong to user X" in order to enforce a
 * concurrent-session limit and to revoke every session for a user, and the
 * adapter interface has no method for that: `accountId` exists only inside
 * the JSONB `payload`. Promoting it to an indexed column keeps both
 * operations an indexed lookup instead of a full-table JSONB scan.
 *
 * Not every model kind carries an `accountId` (`ClientCredentials`,
 * `Interaction` before login completes, `ReplayDetection`), so the column is
 * nullable and the index is partial.
 *
 * Schema only, deliberately. `ADD COLUMN` with no default is metadata-only on
 * PG 11+, and the partial index matches zero rows while every `account_id` is
 * still NULL, so both statements finish in milliseconds. The ACCESS EXCLUSIVE
 * lock this takes on `oidc_model` blocks reads as well as writes, and that
 * table is on the path of every token, session and interaction write, so
 * nothing slow may share a transaction with it. The payload backfill runs
 * separately in `000015`.
 */
export class AddOidcModelAccountId1786486033339 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE oidc_model
        ADD COLUMN account_id VARCHAR(255);
    `);

    // Partial index: only a minority of rows carry an account_id, and every
    // account-scoped query filters on (model_name, account_id) together.
    await queryRunner.query(`
      CREATE INDEX idx_oidc_model_account_id
        ON oidc_model (model_name, account_id)
        WHERE account_id IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_oidc_model_account_id;`);
    await queryRunner.query(
      `ALTER TABLE oidc_model DROP COLUMN IF EXISTS account_id;`,
    );
  }
}
