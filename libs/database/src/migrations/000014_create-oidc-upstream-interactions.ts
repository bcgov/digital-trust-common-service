import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'CreateOidcUpstreamInteractions';

export class CreateOidcUpstreamInteraction1786386020201 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE oidc_upstream_interaction (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

          state TEXT NOT NULL UNIQUE,
          nonce TEXT NOT NULL,
          interaction_uid TEXT NOT NULL UNIQUE,

          code_verifier TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          tenant_user_id TEXT DEFAULT NULL,

          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at TIMESTAMPTZ NOT NULL,

          consumed_at TIMESTAMPTZ
      );
    `);

    await queryRunner.query(`
      CREATE INDEX idx_oidc_upstream_interaction_expires_at
      ON oidc_upstream_interaction (expires_at);
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION consume_oidc_upstream_interaction(p_state TEXT)
      RETURNS TABLE(id UUID, state TEXT, nonce TEXT, interaction_uid TEXT, code_verifier TEXT, created_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, tenant_id TEXT, tenant_user_id TEXT, consumed_at TIMESTAMPTZ) AS $$
      BEGIN
        RETURN QUERY
        UPDATE oidc_upstream_interaction
        SET consumed_at = now()
        WHERE oidc_upstream_interaction.state = p_state
          AND oidc_upstream_interaction.consumed_at IS NULL
          AND oidc_upstream_interaction.expires_at > now()
        RETURNING
          oidc_upstream_interaction.id,
          oidc_upstream_interaction.state,
          oidc_upstream_interaction.nonce,
          oidc_upstream_interaction.interaction_uid,
          oidc_upstream_interaction.code_verifier,
          oidc_upstream_interaction.created_at,
          oidc_upstream_interaction.expires_at,
          oidc_upstream_interaction.tenant_id,
          oidc_upstream_interaction.tenant_user_id,
          oidc_upstream_interaction.consumed_at;
      END;
      $$ LANGUAGE plpgsql;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_oidc_upstream_interaction_expires_at;
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS oidc_upstream_interaction;
    `);

    await queryRunner.query(`
      DROP FUNCTION IF EXISTS consume_oidc_upstream_interaction(TEXT);
    `);
  }
}
