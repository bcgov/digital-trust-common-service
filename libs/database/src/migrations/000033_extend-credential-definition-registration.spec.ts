import {
  ExtendCredentialDefinitionRegistration1792018018010,
  migrationName,
} from './000033_extend-credential-definition-registration';

describe('ExtendCredentialDefinitionRegistration migration', () => {
  const createQueryRunner = (): {
    runner: { query: jest.Mock };
    queries: string[];
  } => {
    const queries: string[] = [];
    return {
      queries,
      runner: {
        query: jest.fn((sql: string) => {
          queries.push(sql);
          return Promise.resolve();
        }),
      },
    };
  };

  it('exports a stable migration name', () => {
    expect(migrationName).toBe('ExtendCredentialDefinitionRegistration');
  });

  it('writes final normalized options and enforces format consistency', async () => {
    const { runner, queries } = createQueryRunner();

    await new ExtendCredentialDefinitionRegistration1792018018010().up(
      runner as never,
    );

    const joined = queries.join('\n');
    expect(joined).toContain("'status', jsonb_build_object(");
    expect(joined).toContain(
      "'revocation', jsonb_build_object('enabled', true)",
    );
    expect(joined).toContain("ELSE jsonb_build_object('format', format::text)");
    expect(joined).toContain("options ->> 'format' = format::text");
    expect(joined).toContain("WHERE registration_state = 'pending'");
  });

  it('removes added schema objects and restores external_id on revert', async () => {
    const { runner, queries } = createQueryRunner();

    await new ExtendCredentialDefinitionRegistration1792018018010().down(
      runner as never,
    );

    const joined = queries.join('\n');
    expect(joined).toContain('DROP COLUMN IF EXISTS options');
    expect(joined).toContain('DROP COLUMN IF EXISTS connector_id');
    expect(joined).toContain('ALTER COLUMN external_id SET NOT NULL');
  });
});
