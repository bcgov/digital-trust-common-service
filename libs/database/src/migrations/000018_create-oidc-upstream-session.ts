import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'CreateOidcUpstreamSession';

export class CreateOidcUpstreamSession1786995277657 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE oidc_upstream_session (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        oidc_model_id UUID
            REFERENCES oidc_model(id)
            ON DELETE CASCADE,

        oidc_session_uid TEXT,

        tenant_user_id UUID NOT NULL
            REFERENCES tenant_user(id)
            ON DELETE CASCADE,

        upstream_subject VARCHAR(255) NOT NULL,

        upstream_id_token TEXT NOT NULL,

        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMPTZ,

        CONSTRAINT uq_oidc_upstream_session_model
            UNIQUE (oidc_model_id),

        CONSTRAINT uq_oidc_upstream_session_uid
            UNIQUE (oidc_session_uid)
      );
    `);

    await queryRunner.query(`
      CREATE INDEX idx_oidc_upstream_session_expires_at
      ON oidc_upstream_session (expires_at);
    `);

    await queryRunner.query(`
      CREATE INDEX idx_oidc_upstream_session_tenant_user_id
      ON oidc_upstream_session (tenant_user_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_oidc_upstream_session_expires_at;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_oidc_upstream_session_tenant_user_id;
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS oidc_upstream_session;`);
  }
}
