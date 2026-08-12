import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';

import { RoleScopeRepository } from './role-scope.repository';

describe('RoleScopeRepository', () => {
  let repository: RoleScopeRepository;
  let mockQuery: jest.Mock;

  beforeEach(async () => {
    mockQuery = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoleScopeRepository,
        {
          provide: getDataSourceToken(),
          useValue: { query: mockQuery },
        },
      ],
    }).compile();

    repository = module.get(RoleScopeRepository);
  });

  it('returns scopes for a role ordered by the query', async () => {
    mockQuery.mockResolvedValue([
      { scope: 'credentials:offer' },
      { scope: 'credentials:verify' },
    ]);

    const scopes = await repository.findScopesForRole('member');

    expect(mockQuery).toHaveBeenCalledWith(
      `SELECT scope FROM role_scope WHERE role = $1::tenant_user_role ORDER BY scope`,
      ['member'],
    );
    expect(scopes).toEqual(['credentials:offer', 'credentials:verify']);
  });

  it('returns an empty array when the role has no mappings', async () => {
    mockQuery.mockResolvedValue([]);

    await expect(repository.findScopesForRole('readonly')).resolves.toEqual(
      [],
    );
  });
});
