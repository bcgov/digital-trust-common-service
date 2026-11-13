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
        ADD COLUMN claim_constraints JSONB NOT NULL DEFAULT '{}',
        ADD COLUMN delivery JSONB NOT NULL DEFAULT '{"protocol":"didcomm-v1"}',
        ALTER COLUMN attribute_schema SET DEFAULT '{}';

      UPDATE issuance_profile profile
      SET claim_constraints = COALESCE((
        SELECT jsonb_object_agg(
          '/' || replace(replace(item.key, '~', '~0'), '/', '~1'),
          jsonb_build_object('default', item.value)
        )
        FROM jsonb_each(COALESCE(profile.defaults, '{}')) item
      ), '{}');
      ALTER TABLE issuance_profile ALTER COLUMN delivery DROP DEFAULT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE issuance_profile
        DROP COLUMN IF EXISTS claim_constraints,
        DROP COLUMN IF EXISTS delivery,
        ALTER COLUMN attribute_schema DROP DEFAULT;
    `);
  }
}
