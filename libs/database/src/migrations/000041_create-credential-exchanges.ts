import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'CreateCredentialExchanges';

export class CreateCredentialExchanges1792506949095 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE credential_exchange (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        connector_id uuid NOT NULL REFERENCES connector_credential(id) ON DELETE RESTRICT,
        connection_id uuid REFERENCES connection(id) ON DELETE SET NULL,
        role varchar(16) NOT NULL CHECK (role IN ('issuer', 'holder')),
        protocol varchar(32) NOT NULL,
        format varchar(32) NOT NULL,
        state varchar(32) NOT NULL DEFAULT 'pending',
        external_id varchar(255),
        issue_submission varchar(32) NOT NULL DEFAULT 'not-submitted'
          CHECK (issue_submission IN ('not-submitted', 'submitting', 'submitted', 'uncertain')),
        issue_operation_id uuid REFERENCES operation(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_credential_exchange_backend UNIQUE (tenant_id, connector_id, external_id)
      );
      CREATE INDEX idx_credential_exchange_tenant ON credential_exchange(tenant_id);
      ALTER TABLE operation ADD COLUMN exchange_id uuid REFERENCES credential_exchange(id) ON DELETE SET NULL;
      ALTER TABLE credential ADD COLUMN exchange_id uuid REFERENCES credential_exchange(id) ON DELETE RESTRICT;
      CREATE INDEX idx_operation_exchange ON operation(exchange_id);
      CREATE UNIQUE INDEX uq_operation_exchange_issue ON operation(tenant_id, exchange_id)
        WHERE type = 'credential.issue' AND exchange_id IS NOT NULL;
      CREATE UNIQUE INDEX uq_credential_exchange ON credential(exchange_id);

      INSERT INTO credential_exchange
        (id, tenant_id, connector_id, connection_id, role, protocol, format, state, external_id, created_at)
      SELECT c.id, c.tenant_id, c.connector_id, c.connection_id, 'issuer',
        COALESCE(o.request->'body'->'delivery'->>'protocol', conn.protocol::text),
        c.format::text,
        CASE c.state::text
          WHEN 'issued' THEN 'credential-issued'
          WHEN 'revoked' THEN 'done'
          WHEN 'failed' THEN 'failed'
          WHEN 'expired' THEN 'abandoned'
          ELSE CASE WHEN c.external_id IS NULL THEN 'pending' ELSE 'offer-sent' END
        END,
        c.external_id, c.created_at
      FROM credential c
      JOIN operation o ON o.id = c.operation_id AND o.tenant_id = c.tenant_id
      JOIN connector_credential cc ON cc.id = c.connector_id AND cc.tenant_id = c.tenant_id
      JOIN connection conn ON conn.id = c.connection_id AND conn.tenant_id = c.tenant_id
      WHERE o.type = 'credential.offer';

      UPDATE credential c SET exchange_id = e.id FROM credential_exchange e
        WHERE c.id = e.id AND c.tenant_id = e.tenant_id;
      UPDATE operation o SET exchange_id = c.exchange_id FROM credential c
        WHERE o.id = c.operation_id AND o.tenant_id = c.tenant_id AND c.exchange_id IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE credential DROP COLUMN IF EXISTS exchange_id;
      ALTER TABLE operation DROP COLUMN IF EXISTS exchange_id;
      DROP TABLE IF EXISTS credential_exchange;
    `);
  }
}
