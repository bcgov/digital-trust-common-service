import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'RestoreIssuanceDeliveryDefault';

export class RestoreIssuanceDeliveryDefault1795099078637 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE issuance_profile
        ALTER COLUMN delivery SET DEFAULT '{"protocol":"didcomm-v1"}'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE issuance_profile ALTER COLUMN delivery DROP DEFAULT
    `);
  }
}
