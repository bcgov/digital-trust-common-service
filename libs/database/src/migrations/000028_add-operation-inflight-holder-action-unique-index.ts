import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'AddOperationInflightHolderActionUniqueIndex';

/**
 * A read-then-create check in CredentialActionService (findByExternalIdForTenant
 * followed by createOperation) is not atomic: two concurrent accept/reject
 * requests can both observe no in-flight row and both create a
 * credential.accept/credential.reject Operation for the same tenant/externalId,
 * and the protocol.state-change worker's newest-first lookup would then only
 * ever complete the newer one, leaving the older sibling pending forever. This
 * partial unique index makes the invariant "at most one in-flight holder-action
 * Operation per offer" a real database guarantee, so a losing concurrent
 * INSERT fails with a unique violation (23505) instead of silently succeeding.
 */
export class AddOperationInflightHolderActionUniqueIndex1789677721725 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_operation_inflight_holder_action
      ON operation (tenant_id, external_id)
      WHERE type IN ('credential.accept', 'credential.reject')
        AND state IN ('pending', 'processing');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS uq_operation_inflight_holder_action;
    `);
  }
}
