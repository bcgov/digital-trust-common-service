import {
  migrationName,
  NestCredentialDefinitionRevocationOptions1792019000000,
} from './000034_nest-credential-definition-revocation-options';

describe('NestCredentialDefinitionRevocationOptions migration', () => {
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
    expect(migrationName).toBe('NestCredentialDefinitionRevocationOptions');
  });

  it('nests AnonCreds revocation options without dropping other status values', async () => {
    const { runner, queries } = createQueryRunner();

    await new NestCredentialDefinitionRevocationOptions1792019000000().up(
      runner as never,
    );

    const joined = queries.join('\n');
    expect(joined).toContain("options - 'revocation'");
    expect(joined).toContain("'{status,revocation}'");
    expect(joined).toContain("WHERE format = 'anoncreds'");
  });

  it('restores the previous options shape on revert', async () => {
    const { runner, queries } = createQueryRunner();

    await new NestCredentialDefinitionRevocationOptions1792019000000().down(
      runner as never,
    );

    const joined = queries.join('\n');
    expect(joined).toContain("options - 'status'");
    expect(joined).toContain("'{status,revocation}'");
    expect(joined).toContain("WHERE format = 'anoncreds'");
  });
});
