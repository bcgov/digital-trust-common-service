import { useQuery } from '@tanstack/react-query';

import { getTenant, listTenants } from '../resources/tenants';
import type { CursorParams } from '../pagination';

export const tenantKeys = {
  all: ['tenants'] as const,
  list: (params: CursorParams) => [...tenantKeys.all, 'list', params] as const,
  detail: (id: string) => [...tenantKeys.all, 'detail', id] as const,
};

export function useTenants(params: CursorParams = {}) {
  return useQuery({
    queryKey: tenantKeys.list(params),
    queryFn: () => listTenants(params),
  });
}

export function useTenant(id: string | undefined) {
  return useQuery({
    queryKey: tenantKeys.detail(id ?? ''),
    queryFn: () => {
      if (!id) throw new Error('Tenant id is required');
      return getTenant(id);
    },
    enabled: Boolean(id),
  });
}
