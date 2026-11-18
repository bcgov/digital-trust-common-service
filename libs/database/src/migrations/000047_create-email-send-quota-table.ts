import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'CreateEmailSendQuotaTable';

export class CreateEmailSendQuotaTable1795195920000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE email_send_quota (
        tenant_id UUID PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
        attempts TIMESTAMPTZ[] NOT NULL DEFAULT '{}'
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS email_send_quota;');
  }
}
