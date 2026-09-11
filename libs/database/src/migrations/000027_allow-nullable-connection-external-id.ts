import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'AllowNullableConnectionExternalId';

export class AllowNullableConnectionExternalId1789300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_connection_external_connection_id;
    `);

    await queryRunner.query(`
      ALTER TABLE connection
        ALTER COLUMN external_connection_id DROP NOT NULL;
    `);

    // The connector.create flow now inserts the connection row before the
    // invitation exists, so external_connection_id starts null and multiple
    // pending rows would otherwise collide on a plain unique index.
    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_connection_external_connection_id
        ON connection (external_connection_id)
        WHERE external_connection_id IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_connection_external_connection_id;
    `);

    await queryRunner.query(`
      ALTER TABLE connection
        ALTER COLUMN external_connection_id SET NOT NULL;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_connection_external_connection_id
        ON connection (external_connection_id);
    `);
  }
}
