import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'CreateIssuanceVerificationProfiles';

export class CreateIssuanceVerificationProfiles1785360000010 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE issuance_profile_protocol_hint AS ENUM (
        'didcomm',
        'oid4vci',
        'auto'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE issuance_profile_status AS ENUM (
        'draft',
        'published',
        'deprecated'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE verification_profile_protocol_hint AS ENUM (
        'didcomm',
        'oid4vp',
        'auto'
      );
    `);

    await queryRunner.query(`
      CREATE TYPE verification_profile_status AS ENUM (
        'draft',
        'published',
        'deprecated'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE issuance_profile (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        name VARCHAR(100) NOT NULL,
        version VARCHAR(20) NOT NULL,
        description TEXT,
        credential_definition_id UUID NOT NULL,
        format credential_definition_format NOT NULL,
        connector_id UUID,
        attribute_schema JSONB NOT NULL,
        defaults JSONB,
        display JSONB,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        protocol_hint issuance_profile_protocol_hint NOT NULL DEFAULT 'auto',
        status issuance_profile_status NOT NULL DEFAULT 'draft',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT fk_issuance_profile_tenant
          FOREIGN KEY (tenant_id)
          REFERENCES tenant(id)
          ON DELETE CASCADE,

        CONSTRAINT fk_issuance_profile_credential_definition
          FOREIGN KEY (credential_definition_id)
          REFERENCES credential_definition(id)
          ON DELETE CASCADE,

        CONSTRAINT fk_issuance_profile_connector
          FOREIGN KEY (connector_id)
          REFERENCES connector_credential(id)
          ON DELETE SET NULL,

        CONSTRAINT uq_issuance_profile_tenant_name_version
          UNIQUE (tenant_id, name, version)
      );
    `);

    await queryRunner.query(`
      CREATE INDEX idx_issuance_profile_tenant_status
      ON issuance_profile (tenant_id, status);
    `);

    await queryRunner.query(`
      CREATE INDEX idx_issuance_profile_credential_definition_id
      ON issuance_profile (credential_definition_id);
    `);

    await queryRunner.query(`
      CREATE TABLE verification_profile (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL,
        issuance_profile_id UUID NOT NULL,
        name VARCHAR(100) NOT NULL,
        version VARCHAR(20) NOT NULL,
        description TEXT,
        presentation_definition JSONB NOT NULL,
        requested_attributes TEXT[],
        predicates JSONB,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        public BOOLEAN NOT NULL DEFAULT false,
        protocol_hint verification_profile_protocol_hint NOT NULL DEFAULT 'auto',
        status verification_profile_status NOT NULL DEFAULT 'draft',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT fk_verification_profile_tenant
          FOREIGN KEY (tenant_id)
          REFERENCES tenant(id)
          ON DELETE CASCADE,

        CONSTRAINT fk_verification_profile_issuance_profile
          FOREIGN KEY (issuance_profile_id)
          REFERENCES issuance_profile(id)
          ON DELETE CASCADE,

        CONSTRAINT uq_verification_profile_tenant_name_version
          UNIQUE (tenant_id, name, version)
      );
    `);

    await queryRunner.query(`
      CREATE INDEX idx_verification_profile_tenant_status
      ON verification_profile (tenant_id, status);
    `);

    await queryRunner.query(`
      CREATE INDEX idx_verification_profile_issuance_profile_id
      ON verification_profile (issuance_profile_id);
    `);

    await queryRunner.query(`
      CREATE INDEX idx_verification_profile_tenant_public
      ON verification_profile (tenant_id, public)
      WHERE public = true;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_verification_profile_tenant_public;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_verification_profile_issuance_profile_id;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_verification_profile_tenant_status;
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS verification_profile;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_issuance_profile_credential_definition_id;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_issuance_profile_tenant_status;
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS issuance_profile;
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS verification_profile_status;
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS verification_profile_protocol_hint;
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS issuance_profile_status;
    `);

    await queryRunner.query(`
      DROP TYPE IF EXISTS issuance_profile_protocol_hint;
    `);
  }
}
