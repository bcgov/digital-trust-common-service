import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'ConfigureIssuanceProfileClaims';

export class ConfigureIssuanceProfileClaims1794328787660 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM issuance_profile WHERE protocol_hint = 'oid4vci'
        ) THEN
          RAISE EXCEPTION 'OID4VCI issuance profiles require explicit delivery migration before upgrading';
        END IF;
      END $$;
      ALTER TABLE issuance_profile
        ADD COLUMN claims JSONB NOT NULL DEFAULT '{}',
        ADD COLUMN delivery JSONB NOT NULL DEFAULT '{"protocol":"didcomm-v1"}',
        ALTER COLUMN attribute_schema SET DEFAULT '{}';

      UPDATE issuance_profile profile
      SET claims = jsonb_build_object(
        'required',
        COALESCE((
          SELECT jsonb_agg(required_claim.name ORDER BY required_claim.name)
          FROM (
            SELECT attribute.name
            FROM credential_definition definition,
              jsonb_array_elements_text(
                CASE
                  WHEN jsonb_typeof(definition.schema_definition->'attr_names') = 'array'
                    THEN definition.schema_definition->'attr_names'
                  ELSE '[]'::jsonb
                END
              ) AS attribute(name)
            WHERE definition.id = profile.credential_definition_id
              AND NOT COALESCE(
                definition.schema_definition->'optional_attributes',
                '[]'::jsonb
              ) ? attribute.name
            UNION
            SELECT legacy_claim.key
            FROM jsonb_each(COALESCE(profile.attribute_schema, '{}')) legacy_claim
            WHERE legacy_claim.value->>'required' = 'true'
          ) required_claim
        ), '[]'::jsonb)
      );
      ALTER TABLE issuance_profile ALTER COLUMN delivery DROP DEFAULT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE issuance_profile
        DROP COLUMN IF EXISTS claims,
        DROP COLUMN IF EXISTS delivery,
        ALTER COLUMN attribute_schema DROP DEFAULT;
    `);
  }
}
