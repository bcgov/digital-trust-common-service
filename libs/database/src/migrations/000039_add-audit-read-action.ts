import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'AddAuditReadAction';

export class AddAuditReadAction1793733978162 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE audit_action_enum ADD VALUE IF NOT EXISTS 'read';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      LOCK TABLE audit_log IN ACCESS EXCLUSIVE MODE;
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM audit_log WHERE action::text = 'read') THEN
          RAISE EXCEPTION 'Cannot remove read action while append-only audit entries use it';
        END IF;
      END $$;
      CREATE TYPE audit_action_enum_without_read AS ENUM (
        'issue', 'verify', 'hold', 'revoke', 'create', 'update', 'delete',
        'login', 'token_grant'
      );
      ALTER TABLE audit_log ALTER COLUMN action
        TYPE audit_action_enum_without_read
        USING action::text::audit_action_enum_without_read;
      DROP TYPE IF EXISTS audit_action_enum;
      ALTER TYPE audit_action_enum_without_read RENAME TO audit_action_enum;
    `);
  }
}
