import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'CreateRoleScopes';

/**
 * Seeds the canonical role→scope mapping used by ScopeGuard and (future)
 * user-token issuance in AU-02. Scope names match docs/DEVELOPER.md.
 *
 * Deliberate vs early AU-04 issue draft: `admin` gets all Level 2 + Level 3
 * scopes (including credentials:hold / credentials:revoke), not the shorter
 * draft list. See docs/DEVELOPER.md "Role → scope seed".
 */
export class CreateRoleScopes1785560000013 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE role_scope (
        role tenant_user_role NOT NULL,
        scope TEXT NOT NULL,
        PRIMARY KEY (role, scope)
      );
    `);

    await queryRunner.query(`
      INSERT INTO role_scope (role, scope) VALUES
        ('owner', 'tenants:admin'),
        ('admin', 'credentials:offer'),
        ('admin', 'credentials:verify'),
        ('admin', 'credentials:hold'),
        ('admin', 'credentials:revoke'),
        ('admin', 'connections:manage'),
        ('admin', 'profiles:manage'),
        ('admin', 'users:manage'),
        ('admin', 'clients:manage'),
        ('admin', 'logs:read'),
        ('admin', 'audit:read'),
        ('member', 'credentials:offer'),
        ('member', 'credentials:verify');
    `);

    await queryRunner.query(`
      ALTER TABLE oauth_client
        ADD COLUMN roles TEXT[] NOT NULL DEFAULT '{}';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE oauth_client
        DROP COLUMN IF EXISTS roles;
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS role_scope;
    `);
  }
}
