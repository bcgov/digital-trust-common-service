import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'CreateWebhookRegistration';

export class CreateWebhookRegistration1795196787879 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE webhook_event AS ENUM (
        'credential.issued',
        'credential.verified',
        'credential.accepted',
        'credential.rejected',
        'credential.revoked',
        'connection.established'
      );

      CREATE TABLE webhook_registration (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        endpoint_url TEXT NOT NULL,
        events webhook_event[] NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        credentials_encrypted BYTEA NOT NULL,
        key_version INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT chk_webhook_registration_events
          CHECK (cardinality(events) > 0 AND array_position(events, NULL) IS NULL)
      );

      CREATE INDEX idx_webhook_registration_tenant_active
        ON webhook_registration (tenant_id, active);

      INSERT INTO role_scope (role, scope)
      VALUES ('admin', 'webhooks:manage')
      ON CONFLICT (role, scope) DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM role_scope
      WHERE role = 'admin' AND scope = 'webhooks:manage';
    `);
    await queryRunner.query('DROP TABLE IF EXISTS webhook_registration;');
    await queryRunner.query('DROP TYPE IF EXISTS webhook_event;');
  }
}
