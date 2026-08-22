import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'CreateTenantRoleScope';

/**
 * Per-tenant role→scope overrides for AU-07 (#40).
 *
 * Scopes are held in an array column rather than one row per scope so that
 * "inherit the default" and "explicitly no scopes" stay distinguishable:
 * an absent row means inherit from `role_scope`, a present row with an empty
 * array means the role has been deliberately stripped. With a row-per-scope
 * table both cases collapse to "no rows", and `readonly` legitimately has no
 * scopes, so the distinction is load-bearing rather than theoretical.
 *
 * It also makes a replace a single upsert instead of a delete-then-insert
 * pair. Array columns already exist here for the same reason
 * (`oauth_client.scopes`, `oauth_client.roles`).
 *
 * Scope names are validated in `RoleScopeService` against the catalog in
 * `@app/auth`, not by a foreign key: scopes are code constants, not rows.
 */
export class CreateTenantRoleScope1787000000020 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE tenant_role_scope (
        tenant_id UUID NOT NULL,

        role tenant_user_role NOT NULL,

        scopes TEXT[] NOT NULL DEFAULT '{}',

        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

        PRIMARY KEY (tenant_id, role),

        CONSTRAINT fk_tenant_role_scope_tenant
          FOREIGN KEY (tenant_id)
          REFERENCES tenant(id)
          ON DELETE CASCADE
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS tenant_role_scope;
    `);
  }
}
