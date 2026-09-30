import { describe, expect, it } from 'vitest';

import { mockTenantRoles } from '@/mocks/handlers';

import { effectiveRoleOptions, TENANT_ROLES } from './roles';

function descriptionOf(
  options: ReturnType<typeof effectiveRoleOptions>,
  id: string,
) {
  return options.find((option) => option.id === id)?.description;
}

describe('effectiveRoleOptions', () => {
  it('keeps the curated copy without a mapping or on the defaults', () => {
    expect(effectiveRoleOptions()).toEqual(TENANT_ROLES);
    expect(effectiveRoleOptions(mockTenantRoles)).toEqual(TENANT_ROLES);
  });

  it('describes an override from its scopes in catalog order', () => {
    const options = effectiveRoleOptions([
      {
        name: 'member',
        scopes: ['credentials:revoke', 'credentials:offer'],
        source: 'override',
      },
    ]);

    expect(descriptionOf(options, 'member')).toBe(
      'Customised for this tenant: issue credentials, revoke credentials.',
    );
    expect(descriptionOf(options, 'admin')).toBe(
      'Manages users, connections and credentials.',
    );
  });

  it('describes an override with no scopes as views only', () => {
    const options = effectiveRoleOptions([
      { name: 'member', scopes: [], source: 'override' },
    ]);

    expect(descriptionOf(options, 'member')).toBe(
      'Customised for this tenant: views only.',
    );
  });

  it('shows a scope it has no words for by name', () => {
    const options = effectiveRoleOptions([
      {
        name: 'readonly',
        scopes: ['reports:read', 'logs:read'],
        source: 'override',
      },
    ]);

    expect(descriptionOf(options, 'readonly')).toBe(
      'Customised for this tenant: read logs, reports:read.',
    );
  });
});
