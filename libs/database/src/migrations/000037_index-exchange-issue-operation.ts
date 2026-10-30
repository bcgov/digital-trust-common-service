import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'IndexExchangeIssueOperation';

export class IndexExchangeIssueOperation1792543244948 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX idx_credential_exchange_issue_operation
      ON credential_exchange (issue_operation_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_credential_exchange_issue_operation',
    );
  }
}
