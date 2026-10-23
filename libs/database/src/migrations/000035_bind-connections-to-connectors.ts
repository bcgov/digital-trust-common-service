import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'BindConnectionsToConnectors';

export class BindConnectionsToConnectors1792502783893 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE connection ADD COLUMN connector_id uuid
        REFERENCES connector_credential(id) ON DELETE RESTRICT;
      CREATE INDEX idx_connection_connector ON connection(connector_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_connection_connector;
      ALTER TABLE connection DROP COLUMN IF EXISTS connector_id;
    `);
  }
}
