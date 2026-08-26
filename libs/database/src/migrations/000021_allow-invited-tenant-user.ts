import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'AllowInvitedTenantUser';

export class AllowInvitedTenantUser1787341200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Invited tenant users have no external_user_id (Keycloak subject) until
    // they complete their first login, so it can no longer be NOT NULL.
    await queryRunner.query(`
      ALTER TABLE tenant_user
      ALTER COLUMN external_user_id DROP NOT NULL;
    `);

    // Dedup invites (and prevent inviting an existing member again) by
    // email within a tenant.
    await queryRunner.query(`
      ALTER TABLE tenant_user
      ADD CONSTRAINT uq_tenant_user_tenant_email UNIQUE (tenant_id, email);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenant_user
      DROP CONSTRAINT uq_tenant_user_tenant_email;
    `);

    // Only safe to restore NOT NULL if no invited (external_user_id IS NULL)
    // rows exist; this will fail loudly rather than silently drop data.
    await queryRunner.query(`
      ALTER TABLE tenant_user
      ALTER COLUMN external_user_id SET NOT NULL;
    `);
  }
}
