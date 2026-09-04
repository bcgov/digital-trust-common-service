import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'CreateRateLimitHitsTable';

export class CreateRateLimitHitsTable1788380667109 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE rate_limit_hits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        tracker TEXT NOT NULL,

        route_key TEXT NOT NULL,

        hit_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await queryRunner.query(`
      CREATE INDEX idx_rate_limit_hits_tracker_route_hit_at
        ON rate_limit_hits (
          tracker,
          route_key,
          hit_at
        );
    `);

    await queryRunner.query(`
      CREATE INDEX idx_rate_limit_hits_hit_at
        ON rate_limit_hits (hit_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_rate_limit_hits_hit_at;
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_rate_limit_hits_tracker_route_hit_at;
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS rate_limit_hits;
    `);
  }
}
