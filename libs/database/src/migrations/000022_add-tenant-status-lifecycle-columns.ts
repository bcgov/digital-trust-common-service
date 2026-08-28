import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'AddTenantStatusLifecycleColumns';

/**
 * Schema support for tenant suspend/deactivate/reactivate.
 *
 * - `tenant.deactivated_at` records when a tenant entered the `deactivated`
 *   status, so a future retention/purge job can measure the 90-day
 *   retention window from it. It is cleared when the tenant is reactivated.
 * - `oauth_client.revoked_reason` distinguishes OAuth clients that were
 *   bulk-revoked as a side effect of tenant deactivation from clients an
 *   admin revoked individually for cause, so reactivation can restore only
 *   the former without resurrecting a deliberately-revoked client.
 */
export class AddTenantStatusLifecycleColumns1787700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenant
        ADD COLUMN deactivated_at TIMESTAMPTZ;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type
          WHERE typname = 'oauth_client_revoked_reason_enum'
        ) THEN
          CREATE TYPE oauth_client_revoked_reason_enum AS ENUM (
            'tenant_deactivation'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE oauth_client
        ADD COLUMN revoked_reason oauth_client_revoked_reason_enum;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE oauth_client
        DROP COLUMN IF EXISTS revoked_reason;
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS oauth_client_revoked_reason_enum;
    `);

    await queryRunner.query(`
      ALTER TABLE tenant
        DROP COLUMN IF EXISTS deactivated_at;
    `);
  }
}
