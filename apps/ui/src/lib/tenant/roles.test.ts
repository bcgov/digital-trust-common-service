import { describe, expect, it } from 'vitest';

import type { TenantRoleMapping } from '@/lib/api/resources/tenant-roles';
import type { TenantRole } from '@/lib/api/resources/tenant-users';

import { effectiveRoleOptions, TENANT_ROLES } from './roles';

// The seed, written out rather than derived, so DEFAULT_ROLE_SCOPES is tested.
const DEFAULTS: TenantRoleMapping[] = [
  { name: 'owner', scopes: ['tenants:admin'], source: 'default' },
  {
    name: 'admin',
    scopes: [
      'audit:read',
      'clients:manage',
      'connections:manage',
      'credentials:hold',
      'credentials:offer',
      'credentials:revoke',
      'credentials:verify',
      'logs:read',
      'profiles:manage',
      'users:manage',
    ],
    source: 'default',
  },
  {
    name: 'member',
    scopes: ['credentials:offer', 'credentials:verify'],
    source: 'default',
  },
  { name: 'readonly', scopes: [], source: 'default' },
];

function describeRole(
  name: TenantRole,
  scopes: string[],
  source: TenantRoleMapping['source'] = 'override',
) {
  return effectiveRoleOptions([{ name, scopes, source }]).find(
    (option) => option.id === name,
  )?.description;
}

describe('effectiveRoleOptions', () => {
  it('keeps the curated copy without a mapping or on the defaults', () => {
    expect(effectiveRoleOptions()).toEqual(TENANT_ROLES);
    expect(effectiveRoleOptions(DEFAULTS)).toEqual(TENANT_ROLES);
  });

  it('describes an override from its scopes in a fixed order', () => {
    expect(
      describeRole('member', ['credentials:revoke', 'credentials:offer']),
    ).toBe(
      'Customised for this tenant: issue credentials, revoke credentials.',
    );
  });

  it('keeps the curated copy for an override that matches the default', () => {
    expect(
      describeRole('member', ['credentials:verify', 'credentials:offer']),
    ).toBe('Issues and verifies credentials.');
  });

  it('does not let a repeated scope pass for the defaults', () => {
    expect(
      describeRole('member', ['credentials:offer', 'credentials:offer']),
    ).toBe('Customised for this tenant: issue credentials.');
  });

  it('lists the scopes of a default that no longer matches its copy', () => {
    expect(
      describeRole(
        'member',
        ['credentials:offer', 'credentials:verify', 'credentials:revoke'],
        'default',
      ),
    ).toBe(
      'Platform default: issue credentials, verify credentials, revoke credentials.',
    );
    expect(describeRole('readonly', ['reports:read'], 'default')).toBe(
      'Platform default: reports:read.',
    );
  });

  it('describes an override with no scopes as views only', () => {
    expect(describeRole('member', [])).toBe(
      'Customised for this tenant: views only.',
    );
  });

  it('shows a scope it has no words for by name', () => {
    expect(describeRole('readonly', ['reports:read', 'logs:read'])).toBe(
      'Customised for this tenant: read logs, reports:read.',
    );
  });
});
