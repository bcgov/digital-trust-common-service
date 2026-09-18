import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'AddOperationInflightRevokeUniqueIndex';

/**
 * Same rationale as 000028's `uq_operation_inflight_holder_action`:
 * CredentialRevokeService unconditionally created a new credential.revoke
 * Operation per call, so a concurrent or retried revoke request could leave
 * an older sibling Operation PENDING/PROCESSING forever, since the
 * protocol.state-change worker's newest-first externalId lookup only ever
 * completes the newest one. This partial unique index makes "at most one
 * in-flight revoke Operation per credential" a database guarantee, so a
 * losing concurrent INSERT fails with a unique violation (23505) instead of
 * silently creating the duplicate.
 */
export class AddOperationInflightRevokeUniqueIndex1789751397831 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Same repair rationale as 000028: fail out older duplicate in-flight
    // rows first so CREATE UNIQUE INDEX doesn't fail against pre-existing data.
    await queryRunner.query(`
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY tenant_id, external_id
                 ORDER BY created_at DESC, id DESC
               ) AS rn
        FROM operation
        WHERE type = 'credential.revoke'
          AND state IN ('pending', 'processing')
      )
      UPDATE operation
      SET state = 'failed',
          result = jsonb_build_object(
            'code', 'SUPERSEDED_DUPLICATE',
            'message', 'Superseded by a newer in-flight revoke operation for the same credential'
          )
      FROM ranked
      WHERE operation.id = ranked.id
        AND ranked.rn > 1;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_operation_inflight_revoke
      ON operation (tenant_id, external_id)
      WHERE type = 'credential.revoke'
        AND state IN ('pending', 'processing');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS uq_operation_inflight_revoke;
    `);
  }
}
