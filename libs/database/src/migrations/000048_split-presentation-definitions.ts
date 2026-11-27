import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'SplitPresentationDefinitions';

export class SplitPresentationDefinitions1795600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE presentation_definition_status AS ENUM ('draft', 'published', 'deprecated');
      CREATE TABLE presentation_definition (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        name varchar(100) NOT NULL,
        version varchar(20) NOT NULL,
        description text,
        presentation_definition jsonb NOT NULL,
        requested_attributes text[],
        predicates jsonb,
        presentation_format varchar(50),
        status presentation_definition_status NOT NULL DEFAULT 'draft',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_presentation_definition_tenant_name_version UNIQUE (tenant_id, name, version),
        CONSTRAINT uq_presentation_definition_tenant_id UNIQUE (tenant_id, id)
      );
      CREATE INDEX idx_presentation_definition_tenant_status
        ON presentation_definition (tenant_id, status);
      INSERT INTO presentation_definition (
        id, tenant_id, name, version, description, presentation_definition,
        requested_attributes, predicates, status, created_at, updated_at
      )
      SELECT id, tenant_id, name, version, description, presentation_definition,
        requested_attributes, predicates, status::text::presentation_definition_status,
        created_at, updated_at
      FROM verification_profile;
      ALTER TABLE verification_profile ADD COLUMN presentation_definition_id uuid,
        ADD COLUMN delivery jsonb;
      UPDATE verification_profile SET presentation_definition_id = id;
      ALTER TABLE verification_profile
        ALTER COLUMN presentation_definition_id SET NOT NULL,
        ADD CONSTRAINT fk_verification_profile_presentation_definition
          FOREIGN KEY (tenant_id, presentation_definition_id)
          REFERENCES presentation_definition(tenant_id, id) ON DELETE RESTRICT;
      CREATE INDEX idx_verification_profile_presentation_definition
        ON verification_profile (tenant_id, presentation_definition_id);
      ALTER TABLE verification_profile DROP COLUMN presentation_definition,
        DROP COLUMN requested_attributes, DROP COLUMN predicates;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE verification_profile ADD COLUMN presentation_definition jsonb,
        ADD COLUMN requested_attributes text[], ADD COLUMN predicates jsonb;
      UPDATE verification_profile p SET
        presentation_definition = d.presentation_definition,
        requested_attributes = d.requested_attributes,
        predicates = d.predicates
      FROM presentation_definition d
      WHERE d.tenant_id = p.tenant_id AND d.id = p.presentation_definition_id;
      ALTER TABLE verification_profile ALTER COLUMN presentation_definition SET NOT NULL;
      ALTER TABLE verification_profile DROP CONSTRAINT IF EXISTS fk_verification_profile_presentation_definition;
      DROP INDEX IF EXISTS idx_verification_profile_presentation_definition;
      ALTER TABLE verification_profile DROP COLUMN presentation_definition_id;
      ALTER TABLE verification_profile DROP COLUMN delivery;
      DROP TABLE IF EXISTS presentation_definition;
      DROP TYPE IF EXISTS presentation_definition_status;
    `);
  }
}
