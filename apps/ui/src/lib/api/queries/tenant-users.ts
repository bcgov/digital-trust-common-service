import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { CursorParams } from '../pagination';
import {
  inviteTenantUser,
  listTenantUsers,
  removeTenantUser,
  updateTenantUser,
  type InviteTenantUserRequest,
  type TenantRole,
} from '../resources/tenant-users';

export const tenantUserKeys = {
  all: ['tenant-users'] as const,
  lists: (tenantId: string) =>
    [...tenantUserKeys.all, 'list', tenantId] as const,
  list: (tenantId: string, params: CursorParams) =>
    [...tenantUserKeys.lists(tenantId), params] as const,
};

export function useTenantUsers(
  tenantId: string | undefined,
  params: CursorParams = {},
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: tenantUserKeys.list(tenantId ?? '', params),
    queryFn: () => {
      if (!tenantId) throw new Error('Tenant id is required');
      return listTenantUsers(tenantId, params);
    },
    enabled: Boolean(tenantId) && options.enabled !== false,
  });
}

// Every mutation refetches the tenant's lists, so the mutation stays pending
// until the table shows the result and a dialog can close on it.
function useInvalidateTenantUsers(tenantId: string) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: tenantUserKeys.lists(tenantId) });
}

export function useInviteTenantUser(tenantId: string) {
  const invalidate = useInvalidateTenantUsers(tenantId);
  return useMutation({
    mutationFn: (body: InviteTenantUserRequest) =>
      inviteTenantUser(tenantId, body),
    onSuccess: invalidate,
  });
}

export function useUpdateTenantUserRole(tenantId: string) {
  const invalidate = useInvalidateTenantUsers(tenantId);
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: TenantRole }) =>
      updateTenantUser(tenantId, userId, { role }),
    onSuccess: invalidate,
  });
}

export function useRemoveTenantUser(tenantId: string) {
  const invalidate = useInvalidateTenantUsers(tenantId);
  return useMutation({
    mutationFn: (userId: string) => removeTenantUser(tenantId, userId),
    onSuccess: invalidate,
  });
}
