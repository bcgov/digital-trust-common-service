import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'AddCredentialStateFailed';

export class AddCredentialStateFailed1789510285355 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE credential_state ADD VALUE IF NOT EXISTS 'failed';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support dropping enum values in place, so the safest
    // reversible migration is a no-op. Existing rows remain valid and the enum
    // remains available for future data or manual database admin workflows.
    await queryRunner.query('SELECT 1;');
  }
}
