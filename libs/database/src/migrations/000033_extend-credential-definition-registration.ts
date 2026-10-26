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
        ADD COLUMN options jsonb;
      CREATE INDEX idx_credential_definition_registration
        ON credential_definition (registration_state)
        WHERE registration_state = 'pending';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_credential_definition_registration;
      ALTER TABLE credential_definition
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
