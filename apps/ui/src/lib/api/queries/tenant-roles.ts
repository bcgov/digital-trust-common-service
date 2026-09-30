import { useQuery } from '@tanstack/react-query';

import { listTenantRoles } from '../resources/tenant-roles';

export const tenantRoleKeys = {
  all: ['tenant-roles'] as const,
  list: (tenantId: string) => [...tenantRoleKeys.all, tenantId] as const,
};

export function useTenantRoles(
  tenantId: string | undefined,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: tenantRoleKeys.list(tenantId ?? ''),
    queryFn: () => {
      if (!tenantId) throw new Error('Tenant id is required');
      return listTenantRoles(tenantId);
    },
    enabled: Boolean(tenantId) && options.enabled !== false,
  });
}
