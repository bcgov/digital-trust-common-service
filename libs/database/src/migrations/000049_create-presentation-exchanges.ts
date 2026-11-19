import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'CreatePresentationExchanges';

export class CreatePresentationExchanges1795105834050 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE presentation_exchange (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        connector_id uuid NOT NULL REFERENCES connector_credential(id) ON DELETE RESTRICT,
        connection_id uuid REFERENCES connection(id) ON DELETE SET NULL,
        external_connection_id varchar(255) NOT NULL,
        protocol varchar(32) NOT NULL,
        format varchar(32) NOT NULL,
        state varchar(32) NOT NULL DEFAULT 'pending',
        external_id varchar(255),
        submission varchar(32) NOT NULL
          CHECK (submission IN ('submitting', 'submitted', 'uncertain')),
        request_operation_id uuid REFERENCES operation(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_presentation_exchange_backend
          UNIQUE (tenant_id, connector_id, external_id),
        CONSTRAINT uq_presentation_exchange_operation
          UNIQUE (request_operation_id)
      );
      CREATE INDEX idx_presentation_exchange_tenant
        ON presentation_exchange (tenant_id);
      ALTER TABLE operation ADD COLUMN presentation_exchange_id uuid
        REFERENCES presentation_exchange(id) ON DELETE SET NULL;
      CREATE INDEX idx_operation_presentation_exchange
        ON operation(presentation_exchange_id);

      INSERT INTO presentation_exchange (
        tenant_id, connector_id, connection_id, external_connection_id,
        protocol, format, state, external_id, submission, request_operation_id,
        created_at, updated_at
      )
      SELECT o.tenant_id, cc.id, conn.id, conn.external_connection_id,
        conn.protocol::text, o.request->'body'->'snapshot'->'options'->>'format',
        CASE
          WHEN o.state::text = 'completed' AND o.result->'verified' = 'true'::jsonb
            THEN 'verified'
          WHEN o.state::text = 'failed' THEN 'failed'
          WHEN o.external_id IS NOT NULL THEN 'request-sent'
          ELSE 'pending'
        END,
        o.external_id,
        CASE WHEN o.external_id IS NULL THEN 'uncertain' ELSE 'submitted' END,
        o.id, o.created_at, o.updated_at
      FROM operation o
      JOIN connector_credential cc
        ON cc.tenant_id = o.tenant_id
        AND cc.id::text = o.request->'body'->'snapshot'->>'connector_id'
      JOIN connection conn
        ON conn.tenant_id = o.tenant_id
        AND conn.id::text = COALESCE(
          o.request->'body'->'delivery'->>'connection_id',
          o.request->'body'->>'connectionId'
        )
        AND conn.external_connection_id =
          o.request->'body'->'snapshot'->'proof_request'->>'connectionId'
        AND (conn.connector_id IS NULL OR conn.connector_id = cc.id)
      WHERE o.type = 'presentation.request'
        AND o.request->'body'->'snapshot'->'options'->>'format' IS NOT NULL
        AND (
          o.external_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM operation other
            WHERE other.id <> o.id AND other.tenant_id = o.tenant_id
              AND other.type = 'presentation.request'
              AND other.external_id = o.external_id
              AND other.request->'body'->'snapshot'->>'connector_id' = cc.id::text
          )
        );

      UPDATE operation o SET presentation_exchange_id = e.id
      FROM presentation_exchange e
      WHERE e.request_operation_id = o.id AND e.tenant_id = o.tenant_id;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE operation DROP COLUMN IF EXISTS presentation_exchange_id;
      DROP TABLE IF EXISTS presentation_exchange;
    `);
  }
}
