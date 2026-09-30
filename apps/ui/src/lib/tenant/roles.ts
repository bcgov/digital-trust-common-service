import type {
  Scope,
  TenantRoleMapping,
} from '@/lib/api/resources/tenant-roles';
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

/** The seeded platform defaults the descriptions above were written for. */
export const DEFAULT_ROLE_SCOPES: Record<TenantRole, readonly Scope[]> = {
  owner: ['tenants:admin'],
  admin: [
    'credentials:offer',
    'credentials:verify',
    'credentials:hold',
    'credentials:revoke',
    'connections:manage',
    'profiles:manage',
    'users:manage',
    'clients:manage',
    'logs:read',
    'audit:read',
  ],
  member: ['credentials:offer', 'credentials:verify'],
  readonly: [],
};

export function roleLabel(role: string | undefined): string {
  return (
    TENANT_ROLES.find((option) => option.id === role)?.label ?? role ?? '—'
  );
}

// Typed against the spec, so a new scope fails the build until it has words.
const SCOPE_PHRASES: Record<Scope, string> = {
  'tenants:admin': 'full control',
  'credentials:offer': 'issue credentials',
  'credentials:verify': 'verify credentials',
  'credentials:hold': 'hold credentials',
  'credentials:revoke': 'revoke credentials',
  'connections:manage': 'manage connections',
  'profiles:manage': 'manage profiles',
  'users:manage': 'manage users',
  'clients:manage': 'manage API clients',
  'logs:read': 'read logs',
  'audit:read': 'read the audit log',
};

function listScopes(scopes: readonly string[]): string {
  const known = Object.entries(SCOPE_PHRASES)
    .filter(([scope]) => scopes.includes(scope))
    .map(([, phrase]) => phrase);
  const unknown = [...new Set(scopes)].filter(
    (scope) => !Object.hasOwn(SCOPE_PHRASES, scope),
  );
  const phrases = [...known, ...unknown];
  return phrases.length > 0 ? phrases.join(', ') : 'views only';
}

// Set equality: the column has no uniqueness constraint.
function sameScopes(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((scope) => set.has(scope));
}

/** Curated copy while a role has the scopes it describes; a scope list otherwise. */
export function effectiveRoleOptions(
  mapping: readonly TenantRoleMapping[] = [],
): TenantRoleOption[] {
  return TENANT_ROLES.map((option) => {
    const entry = mapping.find((role) => role.name === option.id);
    if (
      !entry?.scopes ||
      sameScopes(entry.scopes, DEFAULT_ROLE_SCOPES[option.id])
    ) {
      return option;
    }
    const lead =
      entry.source === 'override'
        ? 'Customised for this tenant'
        : 'Platform default';
    return {
      ...option,
      description: `${lead}: ${listScopes(entry.scopes)}.`,
    };
  });
}
