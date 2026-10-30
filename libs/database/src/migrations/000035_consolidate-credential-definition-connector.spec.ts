import {
  ConsolidateCredentialDefinitionConnector1793383965371,
  migrationName,
} from './000035_consolidate-credential-definition-connector';

describe('ConsolidateCredentialDefinitionConnector migration', () => {
  it('exports a stable migration name', () => {
    expect(migrationName).toBe('ConsolidateCredentialDefinitionConnector');
  });

  it('backfills the canonical binding before dropping the legacy alias', async () => {
    const queryRunner = { query: jest.fn().mockResolvedValue(undefined) };
    const migration =
      new ConsolidateCredentialDefinitionConnector1793383965371();

    await migration.up(queryRunner as never);

    expect(queryRunner.query.mock.calls[0][0]).toContain(
      'SET connector_id = connector_credential_id',
    );
    const sql = queryRunner.query.mock.calls
      .map(([query]) => query as string)
      .join('\n');
    expect(sql).toContain('WHERE connector_id IS NULL');
    expect(sql).toContain('DROP COLUMN IF EXISTS connector_credential_id');
    expect(sql).toContain('idx_credential_definition_connector_id');
  });

  it('restores the alias and its historical delete behavior on rollback', async () => {
    const queryRunner = { query: jest.fn().mockResolvedValue(undefined) };
    const migration =
      new ConsolidateCredentialDefinitionConnector1793383965371();

    await migration.down(queryRunner as never);

    const sql = queryRunner.query.mock.calls
      .map(([query]) => query as string)
      .join('\n');
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS connector_credential_id UUID',
    );
    expect(sql).toContain('SET connector_credential_id = connector_id');
    expect(sql).toContain('ON DELETE SET NULL');
  });
});
