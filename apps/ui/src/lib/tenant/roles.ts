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
