import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'CreateAuditLogSchema';

/**
 * Build monthly partition bounds for [startMonth, startMonth + monthsAhead].
 * startMonth is truncated to the first day of its UTC month.
 */
export function buildMonthlyPartitionSpecs(
  start: Date,
  monthsAhead: number,
): Array<{ name: string; from: string; to: string }> {
  const specs: Array<{ name: string; from: string; to: string }> = [];
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  );

  for (let i = 0; i <= monthsAhead; i += 1) {
    const from = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + i, 1),
    );
    const to = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + i + 1, 1),
    );
    const yyyy = from.getUTCFullYear();
    const mm = String(from.getUTCMonth() + 1).padStart(2, '0');
    specs.push({
      name: `audit_log_${yyyy}_${mm}`,
      from: from.toISOString(),
      to: to.toISOString(),
    });
  }

  return specs;
}

export class CreateAuditLogSchema1784901000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type
          WHERE typname = 'audit_actor_type_enum'
        ) THEN
          CREATE TYPE audit_actor_type_enum AS ENUM (
            'user',
            'system',
            'client'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type
          WHERE typname = 'audit_action_enum'
        ) THEN
          CREATE TYPE audit_action_enum AS ENUM (
            'issue',
            'verify',
            'hold',
            'revoke',
            'create',
            'update',
            'delete',
            'login',
            'token_grant'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE audit_log (
        id UUID NOT NULL DEFAULT gen_random_uuid(),

        tenant_id UUID NOT NULL,
        actor_id VARCHAR(255) NOT NULL,
        actor_type audit_actor_type_enum NOT NULL,
        action audit_action_enum NOT NULL,

        resource_type VARCHAR(100) NOT NULL,
        resource_id UUID NOT NULL,
        operation_id UUID,

        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        ip_address VARCHAR(64),

        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT pk_audit_log PRIMARY KEY (id, created_at),

        CONSTRAINT fk_audit_log_tenant
          FOREIGN KEY (tenant_id)
          REFERENCES tenant(id)
          ON DELETE CASCADE,

        CONSTRAINT fk_audit_log_operation
          FOREIGN KEY (operation_id)
          REFERENCES operation(id)
          ON DELETE SET NULL
      ) PARTITION BY RANGE (created_at);
    `);

    // Current month + next 3 months. Rolling partition creation is a follow-up
    // operational concern (documented in ARCHITECTURE / ops runbook).
    const specs = buildMonthlyPartitionSpecs(new Date(), 3);
    for (const spec of specs) {
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS ${spec.name}
          PARTITION OF audit_log
          FOR VALUES FROM ('${spec.from}') TO ('${spec.to}');
      `);
    }

    await queryRunner.query(`
      CREATE INDEX idx_audit_log_tenant_created
        ON audit_log (tenant_id, created_at);
    `);

    await queryRunner.query(`
      CREATE INDEX idx_audit_log_resource
        ON audit_log (resource_type, resource_id);
    `);

    await queryRunner.query(`
      CREATE INDEX idx_audit_log_operation_id
        ON audit_log (operation_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS audit_log CASCADE;`);
    await queryRunner.query(`DROP TYPE IF EXISTS audit_action_enum;`);
    await queryRunner.query(`DROP TYPE IF EXISTS audit_actor_type_enum;`);
  }
}
