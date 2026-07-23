import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'CreateConnectorCredential';

export class CreateConnectorCredential1784761690087 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE connector_credential (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        tenant_id UUID NOT NULL,

        connector_type connector_type_enum NOT NULL,

        credentials_encrypted BYTEA NOT NULL,

        endpoint_url TEXT NOT NULL,

        active BOOLEAN NOT NULL DEFAULT TRUE,

        key_version INTEGER NOT NULL DEFAULT 1,

        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT fk_connector_credential_tenant
          FOREIGN KEY (tenant_id)
          REFERENCES tenant(id)
          ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX idx_connector_credential_lookup
        ON connector_credential (
          tenant_id,
          connector_type,
          active
        );
    `);

    await queryRunner.query(`
      CREATE INDEX idx_connector_credential_tenant
        ON connector_credential (tenant_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_connector_credential_tenant;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_connector_credential_lookup;
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS connector_credential;
    `);
  }
}
