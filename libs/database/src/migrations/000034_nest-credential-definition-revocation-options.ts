import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'NestCredentialDefinitionRevocationOptions';

export class NestCredentialDefinitionRevocationOptions1792019000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE credential_definition
      SET options = jsonb_set(
        options - 'revocation',
        '{status}',
        COALESCE(options -> 'status', '{}'::jsonb) || jsonb_build_object(
          'revocation',
          COALESCE(
            options #> '{status,revocation}',
            options -> 'revocation',
            '{"enabled": true}'::jsonb
          )
        ),
        true
      )
      WHERE format = 'anoncreds';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE credential_definition
      SET options = (options - 'status') || jsonb_build_object(
        'revocation',
        options #> '{status,revocation}'
      )
      WHERE format = 'anoncreds';
    `);
  }
}
