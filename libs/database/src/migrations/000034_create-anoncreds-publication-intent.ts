import { createHash } from 'node:crypto';

import { MigrationInterface, QueryRunner } from 'typeorm';

export const migrationName = 'CreateAnoncredsPublicationIntent';

interface ExistingRegistration {
  tenant_id: string;
  connector_id: string;
  schema_definition: { schema_name?: string; schema_version?: string };
  options: { tag?: string };
  registration: {
    issuerId: string;
    stage?: string;
    schema?: { id?: string; state?: string };
    definition?: { state?: string };
  };
}

export class CreateAnoncredsPublicationIntent1793375200834 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE anoncreds_publication_intent (
        tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
        connector_id uuid NOT NULL REFERENCES connector_credential(id) ON DELETE CASCADE,
        artifact_key varchar(64) NOT NULL,
        state varchar NOT NULL CHECK (state IN ('publishing', 'submitted', 'rejected')),
        PRIMARY KEY (tenant_id, connector_id, artifact_key)
      );
    `);
    const registrations = (await queryRunner.query(`
      SELECT tenant_id, connector_id, schema_definition, options, registration
      FROM credential_definition
      WHERE format = 'anoncreds' AND connector_id IS NOT NULL
        AND registration IS NOT NULL
    `)) as ExistingRegistration[];
    for (const row of registrations) {
      for (const artifact of ['schema', 'definition'] as const) {
        const progress = row.registration[artifact];
        const uncertain = row.registration.stage === `${artifact}_publication`;
        if ((!progress || Object.keys(progress).length === 0) && !uncertain) {
          continue;
        }
        const identity =
          artifact === 'schema'
            ? [
                artifact,
                row.registration.issuerId,
                row.schema_definition.schema_name,
                row.schema_definition.schema_version,
              ]
            : [
                artifact,
                row.registration.issuerId,
                row.registration.schema?.id,
                row.options.tag ?? 'default',
              ];
        const key = createHash('sha256')
          .update(JSON.stringify(identity))
          .digest('hex');
        await queryRunner.query(
          `
          INSERT INTO anoncreds_publication_intent
            (tenant_id, connector_id, artifact_key, state)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (tenant_id, connector_id, artifact_key) DO UPDATE
            SET state = 'submitted'
            WHERE EXCLUDED.state = 'submitted'
        `,
          [
            row.tenant_id,
            row.connector_id,
            key,
            progress?.state === 'failed' ? 'rejected' : 'submitted',
          ],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS anoncreds_publication_intent',
    );
  }
}
