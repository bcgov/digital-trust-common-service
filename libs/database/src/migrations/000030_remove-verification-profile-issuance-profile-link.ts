import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'RemoveVerificationProfileIssuanceProfileLink';

/**
 * Verification profiles are not tied to this tenant's own issuance
 * profiles: the primary use case is verifying credentials issued by
 * another tenant or an external issuer, so a tenant-scoped
 * issuance_profile_id foreign key does not fit the domain. Drops the
 * column added by CreateIssuanceVerificationProfiles (000010) along with
 * its foreign key and index.
 */
export class RemoveVerificationProfileIssuanceProfileLink1790623456139 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE verification_profile
      DROP CONSTRAINT IF EXISTS fk_verification_profile_issuance_profile;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_verification_profile_issuance_profile_id;
    `);

    await queryRunner.query(`
      ALTER TABLE verification_profile
      DROP COLUMN IF EXISTS issuance_profile_id;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE verification_profile
      ADD COLUMN issuance_profile_id UUID;
    `);

    await queryRunner.query(`
      CREATE INDEX idx_verification_profile_issuance_profile_id
      ON verification_profile (issuance_profile_id);
    `);

    await queryRunner.query(`
      ALTER TABLE verification_profile
      ADD CONSTRAINT fk_verification_profile_issuance_profile
        FOREIGN KEY (issuance_profile_id)
        REFERENCES issuance_profile(id)
        ON DELETE CASCADE;
    `);
  }
}
