import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'AddCredentialDefinitionLifecycle';

export class AddCredentialDefinitionLifecycle1792713600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE credential_definition_status AS ENUM (
        'draft',
        'published',
        'deprecated'
      );
    `);

    await queryRunner.query(`
      ALTER TABLE credential_definition
        ADD COLUMN status credential_definition_status NOT NULL DEFAULT 'draft',
        ADD COLUMN version VARCHAR(255) NOT NULL DEFAULT '1.0',
        ADD COLUMN connector_credential_id UUID;
    `);

    await queryRunner.query(`
      UPDATE credential_definition AS definition
      SET status = 'published',
          version = COALESCE(
            NULLIF(definition.schema_definition ->> 'version', ''),
            '1.0'
          ),
          connector_credential_id = (
            SELECT (ARRAY_AGG(connector.id))[1]
            FROM connector_credential AS connector
            WHERE connector.tenant_id = definition.tenant_id
              AND connector.connector_type::text = definition.connector_type::text
              AND connector.active = true
            HAVING COUNT(*) = 1
          );
    `);

    await queryRunner.query(`
      ALTER TABLE credential_definition
        ADD CONSTRAINT fk_credential_definition_connector_credential
        FOREIGN KEY (connector_credential_id)
        REFERENCES connector_credential(id)
        ON DELETE SET NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX idx_credential_definition_connector_credential_id
      ON credential_definition (connector_credential_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_credential_definition_connector_credential_id;
    `);

    await queryRunner.query(`
      ALTER TABLE credential_definition
        DROP CONSTRAINT IF EXISTS fk_credential_definition_connector_credential,
        DROP COLUMN IF EXISTS connector_credential_id,
        DROP COLUMN IF EXISTS version,
        DROP COLUMN IF EXISTS status;
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS credential_definition_status;
    `);
  }
}
