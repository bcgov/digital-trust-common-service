import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'AddCredentialDefinitionActiveUniqueIndex';

/**
 * Replaces the tenant/name/format uniqueness constraint from migration
 * 000004 with a partial unique index that only applies to active rows, so
 * a deactivated definition's name and format can be reused by a new
 * registration instead of being permanently reserved.
 */
export class AddCredentialDefinitionActiveUniqueIndex1788885810789 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE credential_definition
        DROP CONSTRAINT IF EXISTS uq_credential_definition_tenant_name_format;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_credential_definition_tenant_name_format
      ON credential_definition (tenant_id, name, format)
      WHERE is_active;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS uq_credential_definition_tenant_name_format;
    `);

    await queryRunner.query(`
      ALTER TABLE credential_definition
        ADD CONSTRAINT uq_credential_definition_tenant_name_format
        UNIQUE (tenant_id, name, format);
    `);
  }
}
