import type { ParseKeys } from 'i18next';

import type {
  Scope,
  TenantRoleMapping,
} from '@/lib/api/resources/tenant-roles';
import type { TenantRole } from '@/lib/api/resources/tenant-users';
import i18n from '@/lib/i18n';

export interface TenantRoleOption {
  id: TenantRole;
  label: string;
  description: string;
}

/** Roles from most to least authority. */
export const TENANT_ROLES: readonly TenantRole[] = [
  'owner',
  'admin',
  'member',
  'readonly',
];

/** The seeded platform defaults the role descriptions were written for. */
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

const isRole = (role: string | undefined): role is TenantRole =>
  TENANT_ROLES.some((id) => id === role);

export function roleLabel(role: string | undefined): string {
  return isRole(role) ? i18n.t(`roles.${role}.label`) : (role ?? '—');
}

// Typed against the spec, so a new scope fails the build until it has words.
const SCOPE_PHRASES: Record<Scope, ParseKeys> = {
  'tenants:admin': 'roles.scopes.fullControl',
  'credentials:offer': 'roles.scopes.issueCredentials',
  'credentials:verify': 'roles.scopes.verifyCredentials',
  'credentials:hold': 'roles.scopes.holdCredentials',
  'credentials:revoke': 'roles.scopes.revokeCredentials',
  'connections:manage': 'roles.scopes.manageConnections',
  'profiles:manage': 'roles.scopes.manageProfiles',
  'users:manage': 'roles.scopes.manageUsers',
  'clients:manage': 'roles.scopes.manageClients',
  'logs:read': 'roles.scopes.readLogs',
  'audit:read': 'roles.scopes.readAuditLog',
};

function listScopes(scopes: readonly string[]): string {
  const known = Object.entries(SCOPE_PHRASES)
    .filter(([scope]) => scopes.includes(scope))
    .map(([, key]) => i18n.t(key));
  const unknown = [...new Set(scopes)].filter(
    (scope) => !Object.hasOwn(SCOPE_PHRASES, scope),
  );
  const phrases = [...known, ...unknown];
  return phrases.length > 0
    ? new Intl.ListFormat(i18n.language, { type: 'unit' }).format(phrases)
    : i18n.t('roles.scopes.viewsOnly');
}

// Set equality: order differs and nothing guarantees unique entries.
function sameScopes(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((scope) => set.has(scope));
}

/** Curated copy while a role has the scopes it describes; a scope list otherwise. */
export function effectiveRoleOptions(
  mapping: readonly TenantRoleMapping[] = [],
): TenantRoleOption[] {
  return TENANT_ROLES.map((id) => {
    const option = {
      id,
      label: i18n.t(`roles.${id}.label`),
      description: i18n.t(`roles.${id}.description`),
    };
    const entry = mapping.find((role) => role.name === id);
    if (!entry?.scopes || sameScopes(entry.scopes, DEFAULT_ROLE_SCOPES[id])) {
      return option;
    }
    return {
      ...option,
      description: i18n.t(
        entry.source === 'override'
          ? 'roles.customised'
          : 'roles.platformDefault',
        { scopes: listScopes(entry.scopes) },
      ),
    };
  });
}
