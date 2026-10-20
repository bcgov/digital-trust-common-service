import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'AddRegistrationFingerprints';

export class AddRegistrationFingerprints1792028532450 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE credential_definition
        ADD COLUMN request_fingerprint varchar(47),
        ADD COLUMN artifact_fingerprint varchar(47);
      CREATE UNIQUE INDEX uq_credential_definition_request_fingerprint
        ON credential_definition (tenant_id, request_fingerprint);
      CREATE UNIQUE INDEX uq_credential_definition_artifact_fingerprint
        ON credential_definition (tenant_id, artifact_fingerprint);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS uq_credential_definition_artifact_fingerprint;
      DROP INDEX IF EXISTS uq_credential_definition_request_fingerprint;
      ALTER TABLE credential_definition
        DROP COLUMN IF EXISTS artifact_fingerprint,
        DROP COLUMN IF EXISTS request_fingerprint;
    `);
  }
}
