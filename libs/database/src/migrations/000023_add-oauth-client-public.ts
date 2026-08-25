import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'AddOauthClientPublic';

/**
 * Lets `oauth_client` hold public (PKCE) clients alongside the confidential
 * ones it has carried since #8.
 *
 * Signs the React SPA in with Authorization Code + PKCE. A
 * browser app cannot keep a client secret, so its row has none at all —
 * hence dropping NOT NULL from `client_secret_hash`, plus a CHECK that stops
 * the two kinds of client drifting into each other's shape: a public client
 * carrying a secret, or a confidential one without.
 *
 * `post_logout_redirect_uris` is a separate column rather than a reuse of
 * `redirect_uris` because oidc-provider validates RP-initiated logout
 * returns against its own list; sharing the login redirects would let a
 * sign-out land back on the callback route.
 */
export class AddOauthClientPublic1787900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE oauth_client
        ADD COLUMN is_public BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN post_logout_redirect_uris TEXT[] NOT NULL DEFAULT '{}',
        ALTER COLUMN client_secret_hash DROP NOT NULL;
    `);

    // NOT VALID, then VALIDATE separately — see 000016 for why this two-step
    // is the pattern to copy onto tables large enough for the lock to matter.
    await queryRunner.query(`
      ALTER TABLE oauth_client
        ADD CONSTRAINT chk_oauth_client_secret_matches_kind
        CHECK (
          (is_public AND client_secret_hash IS NULL)
          OR (NOT is_public AND client_secret_hash IS NOT NULL)
        )
        NOT VALID;
    `);

    await queryRunner.query(`
      ALTER TABLE oauth_client
        VALIDATE CONSTRAINT chk_oauth_client_secret_matches_kind;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE oauth_client
        DROP CONSTRAINT IF EXISTS chk_oauth_client_secret_matches_kind;
    `);

    // A public client has no secret and so cannot satisfy the restored NOT
    // NULL. Delete those rows rather than back-filling a hash that would
    // authenticate nobody while looking like a working credential.
    await queryRunner.query(`
      DELETE FROM oauth_client WHERE is_public;
    `);

    await queryRunner.query(`
      ALTER TABLE oauth_client
        DROP COLUMN IF EXISTS post_logout_redirect_uris,
        DROP COLUMN IF EXISTS is_public;
    `);

    await queryRunner.query(`
      ALTER TABLE oauth_client
        ALTER COLUMN client_secret_hash SET NOT NULL;
    `);
  }
}
