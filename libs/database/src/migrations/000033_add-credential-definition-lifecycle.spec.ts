import {
  AddCredentialDefinitionLifecycle1792713600000,
  migrationName,
} from './000033_add-credential-definition-lifecycle';

describe('AddCredentialDefinitionLifecycle migration', () => {
  it('exports a stable migration name', () => {
    expect(migrationName).toBe('AddCredentialDefinitionLifecycle');
  });

  it('adds lifecycle fields and backfills legacy definitions safely', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve();
      }),
    };

    const migration = new AddCredentialDefinitionLifecycle1792713600000();
    await migration.up(queryRunner as never);

    const joined = queries.join('\n');
    expect(joined).toContain(
      "'draft',\n        'published',\n        'deprecated'",
    );
    expect(joined).toContain("SET status = 'published'");
    expect(joined).toContain(
      "NULLIF(definition.schema_definition ->> 'version', '')",
    );
    expect(joined).toContain("'1.0'");
    expect(joined).toContain('connector.tenant_id = definition.tenant_id');
    expect(joined).toContain(
      'connector.connector_type::text = definition.connector_type::text',
    );
    expect(joined).toContain('connector.active = true');
    expect(joined).toContain('HAVING COUNT(*) = 1');
    expect(joined).toContain('ON DELETE SET NULL');
  });

  it('removes the lifecycle fields and type on down', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve();
      }),
    };

    const migration = new AddCredentialDefinitionLifecycle1792713600000();
    await migration.down(queryRunner as never);

    const joined = queries.join('\n');
    expect(joined).toContain(
      'DROP CONSTRAINT IF EXISTS fk_credential_definition_connector_credential',
    );
    expect(joined).toContain('DROP COLUMN IF EXISTS connector_credential_id');
    expect(joined).toContain('DROP COLUMN IF EXISTS version');
    expect(joined).toContain('DROP COLUMN IF EXISTS status');
    expect(joined).toContain(
      'DROP TYPE IF EXISTS credential_definition_status',
    );
  });
});
