import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'RemoveVerificationProtocolHint';

export class RemoveVerificationProtocolHint1795700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM verification_profile
          WHERE protocol_hint = 'oid4vp' AND delivery IS NOT NULL
            AND delivery->>'protocol' IS DISTINCT FROM 'oid4vp'
        ) THEN
          RAISE EXCEPTION 'OID4VP verification profiles with conflicting delivery require explicit migration before upgrading';
        END IF;
      END $$;
      CREATE TABLE verification_profile_protocol_hint_backup (
        profile_id uuid PRIMARY KEY REFERENCES verification_profile(id) ON DELETE CASCADE,
        protocol_hint verification_profile_protocol_hint NOT NULL,
        backfilled_delivery boolean NOT NULL
      );
      INSERT INTO verification_profile_protocol_hint_backup
        (profile_id, protocol_hint, backfilled_delivery)
      SELECT id, protocol_hint, protocol_hint = 'oid4vp' AND delivery IS NULL
      FROM verification_profile;
      UPDATE verification_profile
      SET delivery = '{"protocol":"oid4vp"}'::jsonb
      WHERE protocol_hint = 'oid4vp' AND delivery IS NULL;
      ALTER TABLE verification_profile DROP COLUMN protocol_hint;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE verification_profile ADD COLUMN protocol_hint
        verification_profile_protocol_hint NOT NULL DEFAULT 'auto';
      UPDATE verification_profile profile SET protocol_hint = backup.protocol_hint,
        delivery = CASE
          WHEN backup.backfilled_delivery AND profile.delivery = '{"protocol":"oid4vp"}'::jsonb
            THEN NULL
          ELSE profile.delivery
        END
      FROM verification_profile_protocol_hint_backup backup
      WHERE backup.profile_id = profile.id;
      UPDATE verification_profile profile SET protocol_hint = 'oid4vp'
      WHERE profile.delivery->>'protocol' = 'oid4vp'
        AND NOT EXISTS (
          SELECT 1 FROM verification_profile_protocol_hint_backup backup
          WHERE backup.profile_id = profile.id
        );
      DROP TABLE verification_profile_protocol_hint_backup;
    `);
  }
}
