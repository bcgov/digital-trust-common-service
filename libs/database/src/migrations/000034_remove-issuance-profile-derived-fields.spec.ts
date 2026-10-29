import {
  migrationName,
  RemoveIssuanceProfileDerivedFields1793377253689,
} from './000034_remove-issuance-profile-derived-fields';

describe('RemoveIssuanceProfileDerivedFields migration', () => {
  it('exports a stable migration name', () => {
    expect(migrationName).toBe('RemoveIssuanceProfileDerivedFields');
  });

  it('drops only the duplicated profile fields and connector constraint', async () => {
    const queryRunner = { query: jest.fn().mockResolvedValue(undefined) };
    const migration = new RemoveIssuanceProfileDerivedFields1793377253689();

    await migration.up(queryRunner as never);

    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining(
        'DROP CONSTRAINT IF EXISTS fk_issuance_profile_connector',
      ),
    );
    const sql = queryRunner.query.mock.calls[0][0] as string;
    expect(sql).toContain('DROP COLUMN IF EXISTS connector_id');
    expect(sql).toContain('DROP COLUMN IF EXISTS format');
    expect(sql).not.toContain('DROP COLUMN IF EXISTS credential_definition_id');
  });

  it('restores fields from the tenant-matched definition on rollback', async () => {
    const queryRunner = { query: jest.fn().mockResolvedValue(undefined) };
    const migration = new RemoveIssuanceProfileDerivedFields1793377253689();

    await migration.down(queryRunner as never);

    const sql = queryRunner.query.mock.calls
      .map(([query]) => query as string)
      .join('\n');
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS format credential_definition_format',
    );
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS connector_id UUID');
    expect(sql).toContain('definition.tenant_id = profile.tenant_id');
    expect(sql).toContain('connector_id = definition.connector_credential_id');
    expect(sql).toContain('ALTER COLUMN format SET NOT NULL');
    expect(sql).toContain('REFERENCES connector_credential(id)');
    expect(sql).toContain('ON DELETE SET NULL');
  });
});
