import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'AddOauthClientRefreshTokenTtl';

/**
 * Adds an optional per-client refresh token lifetime to `oauth_client`.
 *
 * AU-08 (#41) requires the refresh token TTL to be "configurable per
 * client". oidc-provider supports this by accepting a
 * `(ctx, token, client) => number` function for `ttl.RefreshToken`, so the
 * value is stored here and surfaced to the provider as extra client
 * metadata.
 *
 * NULL means "inherit the server-wide OIDC_REFRESH_TOKEN_TTL_SECONDS",
 * which is why this is nullable rather than defaulted — a default would
 * freeze existing clients at today's global value and silently detach them
 * from future changes to it.
 */
export class AddOauthClientRefreshTokenTtl1786567439996 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE oauth_client
        ADD COLUMN refresh_token_ttl_seconds INTEGER;
    `);

    // Guard against a zero/negative TTL, which oidc-provider would treat as
    // an already-expired token rather than "no expiry".
    //
    // NOT VALID, then VALIDATE separately: adding a CHECK in one step scans
    // the whole table under ACCESS EXCLUSIVE, while VALIDATE takes only SHARE
    // UPDATE EXCLUSIVE and lets reads and writes through. oauth_client is
    // small enough that it makes no practical difference here, but this is the
    // pattern to copy onto tables where it does.
    await queryRunner.query(`
      ALTER TABLE oauth_client
        ADD CONSTRAINT chk_oauth_client_refresh_token_ttl_positive
        CHECK (refresh_token_ttl_seconds IS NULL OR refresh_token_ttl_seconds > 0)
        NOT VALID;
    `);

    await queryRunner.query(`
      ALTER TABLE oauth_client
        VALIDATE CONSTRAINT chk_oauth_client_refresh_token_ttl_positive;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE oauth_client
        DROP CONSTRAINT IF EXISTS chk_oauth_client_refresh_token_ttl_positive;
    `);
    await queryRunner.query(`
      ALTER TABLE oauth_client
        DROP COLUMN IF EXISTS refresh_token_ttl_seconds;
    `);
  }
}
