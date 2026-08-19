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

        oidc_session_uid TEXT UNIQUE,

        tenant_user_id UUID NOT NULL
            REFERENCES tenant_user(id),

        upstream_subject VARCHAR(255) NOT NULL,

        upstream_id_token TEXT NOT NULL,

        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMPTZ,

        CONSTRAINT uq_oidc_upstream_session_model
            UNIQUE (oidc_model_id)
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_oidc_upstream_session_uid
      ON oidc_upstream_session (oidc_session_uid)
      WHERE oidc_session_uid IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS oidc_upstream_session;`);
  }
}
