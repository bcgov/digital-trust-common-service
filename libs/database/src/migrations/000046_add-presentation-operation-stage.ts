import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'AddPresentationOperationStage';

export class AddPresentationOperationStage1794497941889 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE operation ADD COLUMN presentation_stage smallint NULL CHECK (presentation_stage BETWEEN 0 AND 2)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE operation DROP COLUMN IF EXISTS presentation_stage',
    );
  }
}
