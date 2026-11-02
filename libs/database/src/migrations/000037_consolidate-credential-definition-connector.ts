import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'ConsolidateCredentialDefinitionConnector';

export class ConsolidateCredentialDefinitionConnector1793383965371 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE credential_definition
      SET connector_id = connector_credential_id
      WHERE connector_id IS NULL
        AND connector_credential_id IS NOT NULL;
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_credential_definition_connector_credential_id;
      ALTER TABLE credential_definition
        DROP CONSTRAINT IF EXISTS fk_credential_definition_connector_credential,
        DROP COLUMN IF EXISTS connector_credential_id;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_credential_definition_connector_id
      ON credential_definition (connector_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_credential_definition_connector_id;
      ALTER TABLE credential_definition
        ADD COLUMN IF NOT EXISTS connector_credential_id UUID;
      UPDATE credential_definition
      SET connector_credential_id = connector_id
      WHERE connector_credential_id IS NULL
        AND connector_id IS NOT NULL;
      ALTER TABLE credential_definition
        ADD CONSTRAINT fk_credential_definition_connector_credential
        FOREIGN KEY (connector_credential_id)
        REFERENCES connector_credential(id)
        ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_credential_definition_connector_credential_id
      ON credential_definition (connector_credential_id);
    `);
  }
}
