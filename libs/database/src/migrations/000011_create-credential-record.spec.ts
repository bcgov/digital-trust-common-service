import {
  CreateCredentialRecord1785460000011,
  migrationName,
} from './000011_create-credential-record';

describe('CreateCredentialRecord migration', () => {
  it('exports a stable migration name', () => {
    expect(migrationName).toBe('CreateCredentialRecord');
  });

  it('creates credential table with connector FK', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve();
      }),
    };

    const migration = new CreateCredentialRecord1785460000011();
    await migration.up(queryRunner as never);

    const joined = queries.join('\n');
    expect(joined).toContain('CREATE TABLE credential');
    expect(joined).toContain('CREATE TYPE credential_state');
    expect(joined).toContain('connector_id UUID NOT NULL');
    expect(joined).toContain('fk_credential_connector');
    expect(joined).toContain('REFERENCES connector_credential(id)');
    expect(joined).toContain('ON DELETE RESTRICT');
    expect(joined).toContain('fk_credential_issuance_profile');
    expect(joined).toContain('fk_credential_operation');
    expect(joined).toContain('WHERE external_id IS NOT NULL');
  });

  it('drops credential table and state enum on down', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve();
      }),
    };

    const migration = new CreateCredentialRecord1785460000011();
    await migration.down(queryRunner as never);

    const joined = queries.join('\n');
    expect(joined).toContain('DROP TABLE IF EXISTS credential');
    expect(joined).toContain('DROP TYPE IF EXISTS credential_state');
  });
});
