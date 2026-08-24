import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';

import {
  ROLE_SCOPE_LOCK_CLASS,
  RoleScopeRepository,
} from './role-scope.repository';

const TENANT_ID = '2c9f6c6a-2f1d-4c1a-9b8f-6d5b6d0f7a11';

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

    await expect(repository.findScopesForRole('readonly')).resolves.toEqual([]);
  });

  it('prefers a tenant override over the global default', async () => {
    mockQuery.mockResolvedValueOnce([{ scopes: ['logs:read'] }]);

    const scopes = await repository.findScopesForRole('member', TENANT_ID);

    expect(scopes).toEqual(['logs:read']);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('falls back to the default when the tenant has no override row', async () => {
    // The fallback happens inside the query, so the absent override and the
    // default arrive together.
    mockQuery.mockResolvedValueOnce([{ scopes: ['credentials:offer'] }]);

    const scopes = await repository.findScopesForRole('member', TENANT_ID);

    expect(scopes).toEqual(['credentials:offer']);
  });

  it('resolves a tenant role in a single round trip', async () => {
    // Login is the hottest caller of this path.
    mockQuery.mockResolvedValueOnce([{ scopes: ['logs:read'] }]);

    await repository.findScopesForRole('member', TENANT_ID);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [
      TENANT_ID,
      'member',
    ]);
  });

  it('returns no scopes when neither an override nor a default exists', async () => {
    mockQuery.mockResolvedValueOnce([{ scopes: [] }]);

    await expect(
      repository.findScopesForRole('readonly', TENANT_ID),
    ).resolves.toEqual([]);
  });

  it('treats an override row holding an empty array as no scopes, not inherit', async () => {
    mockQuery.mockResolvedValueOnce([{ scopes: [] }]);

    const scopes = await repository.findScopesForRole('member', TENANT_ID);

    expect(scopes).toEqual([]);
    // The default lookup must not run: an empty array is a deliberate state.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('returns null for a missing override so callers can distinguish inherit', async () => {
    mockQuery.mockResolvedValue([]);

    await expect(
      repository.findTenantOverride(TENANT_ID, 'member'),
    ).resolves.toBeNull();
  });

  it('reports whether a delete removed an override row', async () => {
    mockQuery.mockResolvedValueOnce([[], 1]).mockResolvedValueOnce([[], 0]);

    await expect(
      repository.deleteTenantRoleScopes(TENANT_ID, 'member'),
    ).resolves.toBe(true);
    await expect(
      repository.deleteTenantRoleScopes(TENANT_ID, 'member'),
    ).resolves.toBe(false);
  });

  it('takes the tenant advisory lock on the caller transaction, not the pool', async () => {
    const managerQuery = jest.fn().mockResolvedValue([]);

    await repository.lockTenantForRoleScopeWrite(TENANT_ID, {
      query: managerQuery,
    } as unknown as EntityManager);

    expect(managerQuery).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock($1, hashtext($2))',
      [ROLE_SCOPE_LOCK_CLASS, TENANT_ID],
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
