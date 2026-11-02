import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'RemoveIssuanceProfileDerivedFields';

export class RemoveIssuanceProfileDerivedFields1793377253689 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE issuance_profile
        DROP CONSTRAINT IF EXISTS fk_issuance_profile_connector,
        DROP COLUMN IF EXISTS connector_id,
        DROP COLUMN IF EXISTS format;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE issuance_profile
        ADD COLUMN IF NOT EXISTS format credential_definition_format,
        ADD COLUMN IF NOT EXISTS connector_id UUID;
    `);
    await queryRunner.query(`
      UPDATE issuance_profile AS profile
      SET format = definition.format,
          connector_id = definition.connector_credential_id
      FROM credential_definition AS definition
      WHERE definition.id = profile.credential_definition_id
        AND definition.tenant_id = profile.tenant_id;
    `);
    await queryRunner.query(`
      ALTER TABLE issuance_profile
        ALTER COLUMN format SET NOT NULL,
        DROP CONSTRAINT IF EXISTS fk_issuance_profile_connector;
    `);
    await queryRunner.query(`
      ALTER TABLE issuance_profile
        ADD CONSTRAINT fk_issuance_profile_connector
        FOREIGN KEY (connector_id) REFERENCES connector_credential(id)
        ON DELETE SET NULL;
    `);
  }
}
