import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'AddConnectorAgentLogIdHash';

export class AddConnectorAgentLogIdHash1793385084139 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE connector_credential
        ADD COLUMN agent_log_id_hash text;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_connector_credential_agent_log_id_hash
        ON connector_credential (agent_log_id_hash)
        WHERE active = true AND agent_log_id_hash IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS uq_connector_credential_agent_log_id_hash;
    `);
    await queryRunner.query(`
      ALTER TABLE connector_credential
        DROP COLUMN IF EXISTS agent_log_id_hash;
    `);
  }
}
