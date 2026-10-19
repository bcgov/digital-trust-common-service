import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createTenant,
  getTenant,
  listTenants,
  type CreateTenantRequest,
} from '../resources/tenants';
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

export function useTenant(
  id: string | undefined,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: tenantKeys.detail(id ?? ''),
    queryFn: () => {
      if (!id) throw new Error('Tenant id is required');
      return getTenant(id);
    },
    enabled: Boolean(id) && options.enabled !== false,
  });
}

export function useCreateTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTenantRequest) => createTenant(body),
    // Stays pending until the list refetches so the dialog can close on it.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: tenantKeys.all }),
  });
}
