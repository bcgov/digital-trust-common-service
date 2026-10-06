import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'AddTenantUserPlatformOperator';

/**
 * Adds `is_platform_operator` to `tenant_user`.
 *
 * `platform-admin` was previously grantable only to the one
 * `client_credentials` OAuth client (`dtsc-platform-admin`), never to a
 * human session: `findAccount`/`extraTokenClaims` resolve exclusively
 * through a `tenant_user` row, and there is no tenant-less SPA client. This
 * column lets a human `tenant_user` be flagged so their OIDC tokens also
 * carry the `platform-admin` role, which `ScopeGuard` already treats as a
 * bypass for every role/scope check. Defaulted to `false` so every existing
 * row stays scoped to its own tenant.
 */
export class AddTenantUserPlatformOperator1790900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenant_user
        ADD COLUMN is_platform_operator BOOLEAN NOT NULL DEFAULT false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenant_user
        DROP COLUMN IF EXISTS is_platform_operator;
    `);
  }
}
