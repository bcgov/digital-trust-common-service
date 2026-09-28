import {
  RemoveVerificationProfileIssuanceProfileLink1790623456139,
  migrationName,
} from './000030_remove-verification-profile-issuance-profile-link';

describe('RemoveVerificationProfileIssuanceProfileLink migration', () => {
  it('exports a stable migration name', () => {
    expect(migrationName).toBe('RemoveVerificationProfileIssuanceProfileLink');
  });

  it('drops the FK, index, and column on up', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve();
      }),
    };

    const migration =
      new RemoveVerificationProfileIssuanceProfileLink1790623456139();
    await migration.up(queryRunner as never);

    const joined = queries.join('\n');
    expect(joined).toContain(
      'DROP CONSTRAINT IF EXISTS fk_verification_profile_issuance_profile',
    );
    expect(joined).toContain(
      'DROP INDEX IF EXISTS idx_verification_profile_issuance_profile_id',
    );
    expect(joined).toContain('DROP COLUMN IF EXISTS issuance_profile_id');

    const fkDropIndex = queries.findIndex((q) =>
      q.includes(
        'DROP CONSTRAINT IF EXISTS fk_verification_profile_issuance_profile',
      ),
    );
    const columnDropIndex = queries.findIndex((q) =>
      q.includes('DROP COLUMN IF EXISTS issuance_profile_id'),
    );
    expect(fkDropIndex).toBeGreaterThanOrEqual(0);
    expect(columnDropIndex).toBeGreaterThan(fkDropIndex);
  });

  it('restores the column, index, and FK on down', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve();
      }),
    };

    const migration =
      new RemoveVerificationProfileIssuanceProfileLink1790623456139();
    await migration.down(queryRunner as never);

    const joined = queries.join('\n');
    expect(joined).toContain('ADD COLUMN issuance_profile_id UUID');
    expect(joined).toContain(
      'CREATE INDEX idx_verification_profile_issuance_profile_id',
    );
    expect(joined).toContain(
      'ADD CONSTRAINT fk_verification_profile_issuance_profile',
    );
    expect(joined).toContain('REFERENCES issuance_profile(id)');
  });
});
