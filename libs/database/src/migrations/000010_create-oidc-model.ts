import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'CreateOidcModel';

/**
 * Generic storage for oidc-provider's session/grant model kinds
 * (Session, AuthorizationCode, AccessToken, RefreshToken, DeviceCode,
 * Interaction, ReplayDetection, PushedAuthorizationRequest, etc).
 *
 * Follows the "single generic adapter table" shape recommended by
 * oidc-provider: one row per (model_name, oidc_id), a JSONB payload, and a
 * handful of indexed lookup columns used by specific adapter methods
 * (findByUserCode, findByUid, revokeByGrantId).
 *
 * Client credentials are NOT stored here, the Client adapter reads from
 * the existing `oauth_client` table (see AU-01 plan).
 */
export class CreateOidcModel1785431598677 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE oidc_model (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        model_name VARCHAR(50) NOT NULL,
        oidc_id VARCHAR(255) NOT NULL,

        payload JSONB NOT NULL,

        grant_id VARCHAR(255),
        user_code VARCHAR(255),
        uid VARCHAR(255),

        expires_at TIMESTAMPTZ,
        consumed_at TIMESTAMPTZ,

        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT uq_oidc_model_name_id UNIQUE (model_name, oidc_id)
      );
    `);

    await queryRunner.query(`
      CREATE INDEX idx_oidc_model_grant_id
        ON oidc_model (model_name, grant_id)
        WHERE grant_id IS NOT NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX idx_oidc_model_user_code
        ON oidc_model (model_name, user_code)
        WHERE user_code IS NOT NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX idx_oidc_model_uid
        ON oidc_model (model_name, uid)
        WHERE uid IS NOT NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX idx_oidc_model_expires_at
        ON oidc_model (expires_at)
        WHERE expires_at IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_oidc_model_expires_at;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_oidc_model_uid;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_oidc_model_user_code;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_oidc_model_grant_id;`);
    await queryRunner.query(`DROP TABLE IF EXISTS oidc_model;`);
  }
}
