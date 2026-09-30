import type { TenantRoleMapping } from '@/lib/api/resources/tenant-roles';
import type { TenantRole } from '@/lib/api/resources/tenant-users';

export interface TenantRoleOption {
  id: TenantRole;
  label: string;
  description: string;
}

/** Roles from most to least authority, in the words the UI uses for them. */
export const TENANT_ROLES: readonly TenantRoleOption[] = [
  {
    id: 'owner',
    label: 'Owner',
    description: 'Full control, including roles and tenant settings.',
  },
  {
    id: 'admin',
    label: 'Admin',
    description: 'Manages users, connections and credentials.',
  },
  {
    id: 'member',
    label: 'Member',
    description: 'Issues and verifies credentials.',
  },
  {
    id: 'readonly',
    label: 'Read-only',
    description: 'Views only; cannot make changes.',
  },
];

export function roleLabel(role: string | undefined): string {
  return (
    TENANT_ROLES.find((option) => option.id === role)?.label ?? role ?? '—'
  );
}

// Catalog order, so the wording doesn't depend on the order the API sends.
const SCOPE_PHRASES = new Map<string, string>([
  ['credentials:offer', 'issue credentials'],
  ['credentials:verify', 'verify credentials'],
  ['credentials:hold', 'hold credentials'],
  ['credentials:revoke', 'revoke credentials'],
  ['connections:manage', 'manage connections'],
  ['profiles:manage', 'manage profiles'],
  ['users:manage', 'manage users'],
  ['clients:manage', 'manage API clients'],
  ['logs:read', 'read logs'],
  ['audit:read', 'read the audit log'],
]);

function describeOverride(scopes: readonly string[]): string {
  const known = [...SCOPE_PHRASES]
    .filter(([scope]) => scopes.includes(scope))
    .map(([, phrase]) => phrase);
  const unknown = scopes.filter((scope) => !SCOPE_PHRASES.has(scope));
  const phrases = [...known, ...unknown];
  return `Customised for this tenant: ${phrases.length > 0 ? phrases.join(', ') : 'views only'}.`;
}

/** Role options whose descriptions follow the tenant's overrides. */
export function effectiveRoleOptions(
  mapping: readonly TenantRoleMapping[] = [],
): TenantRoleOption[] {
  return TENANT_ROLES.map((option) => {
    const entry = mapping.find((role) => role.name === option.id);
    return entry?.source === 'override'
      ? { ...option, description: describeOverride(entry.scopes ?? []) }
      : option;
  });
}
