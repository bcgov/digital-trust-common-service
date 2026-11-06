import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'DropRedundantExchangeIssueIndex';

export class DropRedundantExchangeIssueIndex1793375254070 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS uq_operation_exchange_issue');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_operation_exchange_issue
      ON operation(tenant_id, exchange_id)
      WHERE type = 'credential.issue' AND exchange_id IS NOT NULL
    `);
  }
}
