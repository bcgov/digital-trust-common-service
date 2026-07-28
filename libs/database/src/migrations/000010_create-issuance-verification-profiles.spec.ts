import {
  CreateIssuanceVerificationProfiles1785360000010,
  migrationName,
} from './000010_create-issuance-verification-profiles';

describe('CreateIssuanceVerificationProfiles migration', () => {
  it('exports a stable migration name', () => {
    expect(migrationName).toBe('CreateIssuanceVerificationProfiles');
  });

  it('creates both profile tables with connector FK', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve();
      }),
    };

    const migration = new CreateIssuanceVerificationProfiles1785360000010();
    await migration.up(queryRunner as never);

    const joined = queries.join('\n');
    expect(joined).toContain('CREATE TABLE issuance_profile');
    expect(joined).toContain('CREATE TABLE verification_profile');
    expect(joined).toContain('fk_issuance_profile_connector');
    expect(joined).toContain('REFERENCES connector_credential(id)');
    expect(joined).toContain('WHERE public = true');
  });

  it('drops verification then issuance tables on down', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve();
      }),
    };

    const migration = new CreateIssuanceVerificationProfiles1785360000010();
    await migration.down(queryRunner as never);

    const verificationDrop = queries.findIndex((q) =>
      q.includes('DROP TABLE IF EXISTS verification_profile'),
    );
    const issuanceDrop = queries.findIndex((q) =>
      q.includes('DROP TABLE IF EXISTS issuance_profile'),
    );
    expect(verificationDrop).toBeGreaterThanOrEqual(0);
    expect(issuanceDrop).toBeGreaterThan(verificationDrop);
  });
});
