import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'AddPresentationDefinitionFormat';

export class AddPresentationDefinitionFormat1793288034325 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE verification_profile
        ADD COLUMN presentation_format varchar(50)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE verification_profile
        DROP COLUMN IF EXISTS presentation_format
    `);
  }
}
