import { describe, expect, it } from 'vitest';

import type { TenantRoleMapping } from '@/lib/api/resources/tenant-roles';

import { effectiveRoleOptions, TENANT_ROLES } from './roles';

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

function descriptionOf(mapping: TenantRoleMapping[], id: string) {
  return effectiveRoleOptions(mapping).find((option) => option.id === id)
    ?.description;
}

describe('effectiveRoleOptions', () => {
  it('keeps the curated copy without a mapping or on the defaults', () => {
    expect(effectiveRoleOptions()).toEqual(TENANT_ROLES);
    expect(effectiveRoleOptions(DEFAULTS)).toEqual(TENANT_ROLES);
  });

  it('describes an override from its scopes in a fixed order', () => {
    const mapping: TenantRoleMapping[] = [
      {
        name: 'member',
        scopes: ['credentials:revoke', 'credentials:offer'],
        source: 'override',
      },
    ];

    expect(descriptionOf(mapping, 'member')).toBe(
      'Customised for this tenant: issue credentials, revoke credentials.',
    );
    expect(descriptionOf(mapping, 'admin')).toBe(
      'Manages users, connections and credentials.',
    );
  });

  it('keeps the curated copy for an override that matches the default', () => {
    const mapping: TenantRoleMapping[] = [
      {
        name: 'member',
        scopes: ['credentials:verify', 'credentials:offer'],
        source: 'override',
      },
    ];

    expect(descriptionOf(mapping, 'member')).toBe(
      'Issues and verifies credentials.',
    );
  });

  it('lists the scopes of a default that no longer matches its copy', () => {
    const mapping: TenantRoleMapping[] = [
      {
        name: 'member',
        scopes: [
          'credentials:offer',
          'credentials:verify',
          'credentials:revoke',
        ],
        source: 'default',
      },
    ];

    expect(descriptionOf(mapping, 'member')).toBe(
      'Issue credentials, verify credentials, revoke credentials.',
    );
  });

  it('describes an override with no scopes as views only', () => {
    expect(
      descriptionOf(
        [{ name: 'member', scopes: [], source: 'override' }],
        'member',
      ),
    ).toBe('Customised for this tenant: views only.');
  });

  it('shows a scope it has no words for by name', () => {
    const mapping: TenantRoleMapping[] = [
      {
        name: 'readonly',
        scopes: ['reports:read', 'logs:read'],
        source: 'override',
      },
    ];

    expect(descriptionOf(mapping, 'readonly')).toBe(
      'Customised for this tenant: read logs, reports:read.',
    );
  });
});
