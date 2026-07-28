import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'CreateOauthClient';

export class CreateOauthClient1784761471729 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE oauth_client (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        tenant_id UUID NOT NULL,

        client_id VARCHAR(255) NOT NULL,
        client_secret_hash TEXT NOT NULL,

        name VARCHAR(255) NOT NULL,

        scopes TEXT[] NOT NULL DEFAULT '{}',
        redirect_uris TEXT[] NOT NULL DEFAULT '{}',
        grant_types TEXT[] NOT NULL DEFAULT ARRAY['client_credentials'],

        created_by UUID,

        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        revoked_at TIMESTAMPTZ,

        CONSTRAINT fk_oauth_client_tenant
          FOREIGN KEY (tenant_id)
          REFERENCES tenant(id)
          ON DELETE CASCADE,

        CONSTRAINT uq_oauth_client_client_id
          UNIQUE (client_id)
      );
    `);

    await queryRunner.query(`
      CREATE INDEX idx_oauth_client_tenant
        ON oauth_client (tenant_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_oauth_client_tenant;
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS oauth_client;
    `);
  }
}
