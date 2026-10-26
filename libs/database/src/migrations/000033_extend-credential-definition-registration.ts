import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'ExtendCredentialDefinitionRegistration';

export class ExtendCredentialDefinitionRegistration1792018018010 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE credential_definition
        ALTER COLUMN external_id TYPE text,
        ALTER COLUMN external_id DROP NOT NULL,
        ADD COLUMN connector_id uuid REFERENCES connector_credential(id)
          ON DELETE RESTRICT,
        ADD COLUMN registration_state varchar NOT NULL DEFAULT 'unverified'
          CHECK (registration_state IN ('unverified', 'pending', 'ready', 'failed')),
        ADD COLUMN registration_operation_id uuid,
        ADD COLUMN registration jsonb,
        ADD COLUMN options jsonb,
        ADD COLUMN request_fingerprint varchar(47),
        ADD COLUMN artifact_fingerprint varchar(47);
      CREATE INDEX idx_credential_definition_registration
        ON credential_definition (registration_state)
        WHERE registration_state = 'pending';
      CREATE UNIQUE INDEX uq_credential_definition_request_fingerprint
        ON credential_definition (tenant_id, request_fingerprint)
        WHERE is_active;
      CREATE UNIQUE INDEX uq_credential_definition_artifact_fingerprint
        ON credential_definition (tenant_id, artifact_fingerprint)
        WHERE is_active;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_credential_definition_registration;
      DROP INDEX IF EXISTS uq_credential_definition_artifact_fingerprint;
      DROP INDEX IF EXISTS uq_credential_definition_request_fingerprint;
      ALTER TABLE credential_definition
        DROP COLUMN IF EXISTS artifact_fingerprint,
        DROP COLUMN IF EXISTS request_fingerprint,
        DROP COLUMN IF EXISTS options,
        DROP COLUMN IF EXISTS registration,
        DROP COLUMN IF EXISTS registration_operation_id,
        DROP COLUMN IF EXISTS registration_state,
        DROP COLUMN IF EXISTS connector_id;
    `);
    // Do not truncate identifiers or invent external IDs during rollback.
    await queryRunner.query(`
      ALTER TABLE credential_definition
        ALTER COLUMN external_id TYPE varchar(255),
        ALTER COLUMN external_id SET NOT NULL;
    `);
  }
}
