import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'PersistOperationSteps';

export class PersistOperationSteps1794928308442 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE operation
      ADD COLUMN steps JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE operation
      DROP COLUMN steps
    `);
  }
}
