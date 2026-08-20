import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'AddTenantApprovalStatus';

export class AddTenantApprovalStatus1787255721437 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE tenant_status ADD VALUE IF NOT EXISTS 'pending_approval';
    `);

    await queryRunner.query(`
      ALTER TYPE tenant_status ADD VALUE IF NOT EXISTS 'rejected';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support dropping enum values in place, so the safest
    // reversible migration is a no-op. Existing rows remain valid and the enum
    // remains available for future data or manual database admin workflows.
    await queryRunner.query('SELECT 1;');
  }
}
