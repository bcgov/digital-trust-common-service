import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'AddCredentialDefinitionActive';

/**
 * Adds `is_active` to `credential_definition` so DELETE
 * /credential-definitions/:id (CA-08) can deactivate a definition instead of
 * removing the row — matching the `connector_credential.active` pattern,
 * since other records (e.g. an issuance profile's `credential_definition_id`)
 * may still reference it after it stops being offered.
 */
export class AddCredentialDefinitionActive1788353244312 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE credential_definition
        ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE credential_definition
        DROP COLUMN IF EXISTS is_active;
    `);
  }
}
