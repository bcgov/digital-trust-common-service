import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createTenant,
  deleteTenant,
  getTenant,
  getTenantOnboarding,
  listTenants,
  updateTenant,
  type CreateTenantRequest,
  type TenantOnboarding,
  type TenantStatus,
  type UpdateTenantRequest,
} from '../resources/tenants';
import type { CursorParams } from '../pagination';

export const tenantKeys = {
  all: ['tenants'] as const,
  list: (params: CursorParams) => [...tenantKeys.all, 'list', params] as const,
  allForSwitcher: () => [...tenantKeys.all, 'switcher'] as const,
  detail: (id: string) => [...tenantKeys.all, 'detail', id] as const,
  onboarding: (id: string) => [...tenantKeys.detail(id), 'onboarding'] as const,
};

export function useSwitcherTenants(enabled: boolean) {
  return useQuery({
    queryKey: tenantKeys.allForSwitcher(),
    enabled,
    queryFn: async () => {
      const tenants: { id: string; name: string; status?: TenantStatus }[] = [];
      const cursors = new Set<string>();
      let cursor: string | undefined;
      let hasMore = true;
      while (hasMore) {
        const page = await listTenants({ limit: 100, cursor });
        for (const tenant of page.data) {
          if (!tenant.id || !tenant.name) {
            throw new Error('Tenant list entry is missing its id or name');
          }
          tenants.push({
            id: tenant.id,
            name: tenant.name,
            status: tenant.status,
          });
        }
        hasMore = page.pagination.has_more;
        if (!hasMore) break;
        const next = page.pagination.next_cursor;
        if (!next || cursors.has(next)) {
          throw new Error('Tenant list has an invalid pagination cursor');
        }
        cursors.add(next);
        cursor = next;
      }
      return tenants;
    },
  });
}

export function useTenants(
  params: CursorParams = {},
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: tenantKeys.list(params),
    queryFn: () => listTenants(params),
    enabled: options.enabled !== false,
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

export function useTenantOnboarding(
  tenantId: string | undefined,
  options: {
    enabled?: boolean;
    refetchInterval?:
      number | false | ((data: TenantOnboarding | undefined) => number | false);
  } = {},
) {
  const refetchInterval = options.refetchInterval;

  return useQuery<TenantOnboarding>({
    queryKey: tenantKeys.onboarding(tenantId ?? ''),
    queryFn: () => {
      if (!tenantId) throw new Error('Tenant id is required');
      return getTenantOnboarding(tenantId);
    },
    enabled: Boolean(tenantId) && options.enabled !== false,
    refetchInterval:
      typeof refetchInterval === 'function'
        ? (query) => refetchInterval(query.state.data)
        : refetchInterval,
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

export function useUpdateTenant(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateTenantRequest) => updateTenant(id, body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: tenantKeys.all }),
  });
}

export function useDeleteTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTenant(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: tenantKeys.all }),
  });
}
