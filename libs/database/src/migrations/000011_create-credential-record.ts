import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'CreateCredentialRecord';

export class CreateCredentialRecord1785460000011 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE credential_state AS ENUM (
        'offered',
        'issued',
        'revoked',
        'expired'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE credential (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        issuance_profile_id UUID,
        connection_id UUID,
        connector_id UUID NOT NULL,
        external_id VARCHAR(255),
        format credential_definition_format NOT NULL,
        state credential_state NOT NULL DEFAULT 'offered',
        operation_id UUID NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        issued_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT fk_credential_tenant
          FOREIGN KEY (tenant_id)
          REFERENCES tenant(id)
          ON DELETE CASCADE,

        CONSTRAINT fk_credential_issuance_profile
          FOREIGN KEY (issuance_profile_id)
          REFERENCES issuance_profile(id)
          ON DELETE SET NULL,

        CONSTRAINT fk_credential_connection
          FOREIGN KEY (connection_id)
          REFERENCES connection(id)
          ON DELETE SET NULL,

        CONSTRAINT fk_credential_connector
          FOREIGN KEY (connector_id)
          REFERENCES connector_credential(id)
          ON DELETE RESTRICT,

        CONSTRAINT fk_credential_operation
          FOREIGN KEY (operation_id)
          REFERENCES operation(id)
          ON DELETE RESTRICT
      );
    `);

    await queryRunner.query(`
      CREATE INDEX idx_credential_tenant_state
      ON credential (tenant_id, state);
    `);

    await queryRunner.query(`
      CREATE INDEX idx_credential_issuance_profile_id
      ON credential (issuance_profile_id);
    `);

    await queryRunner.query(`
      CREATE INDEX idx_credential_connection_id
      ON credential (connection_id);
    `);

    await queryRunner.query(`
      CREATE INDEX idx_credential_connector_id
      ON credential (connector_id);
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_credential_tenant_external_id
      ON credential (tenant_id, external_id)
      WHERE external_id IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS uq_credential_tenant_external_id;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_credential_connector_id;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_credential_connection_id;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_credential_issuance_profile_id;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_credential_tenant_state;
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS credential;
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS credential_state;
    `);
  }
}
