import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';

import { authKeys, useAuthTenants } from '@/lib/api/queries/auth';
import type { AuthTenant } from '@/lib/api/resources/auth';
import { useAuth } from '@/lib/auth/context';

/**
 * Same section, other tenant: `/tenants/<from>/connections` becomes
 * `/tenants/<to>/connections`. A path not under `/tenants/<from>` comes back
 * unchanged.
 */
export function replaceTenantInPath(
  pathname: string,
  from: string,
  to: string,
): string {
  const prefix = `/tenants/${from}`;
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) {
    return pathname;
  }
  return `/tenants/${to}${pathname.slice(prefix.length)}`;
}

export interface ActiveTenant {
  /**
   * The membership matching the token's tenant. Null while the list loads,
   * and null if the token names a tenant the list does not carry (a
   * membership that was removed or a tenant since deleted).
   */
  tenant: AuthTenant | null;
  memberships: AuthTenant[];
  status: 'loading' | 'ready' | 'error';
  refetch: () => void;
}

/** What the UI knows about the tenant the current token is bound to. */
export function useActiveTenant(): ActiveTenant {
  const { user } = useAuth();
  const { data, isPending, isError, refetch } = useAuthTenants();

  const memberships = data ?? [];
  const tenant =
    memberships.find((membership) => membership.id === user?.tenantId) ?? null;

  return {
    tenant,
    memberships,
    status: isPending ? 'loading' : isError ? 'error' : 'ready',
    refetch: () => {
      void refetch();
    },
  };
}

interface SwitchVariables {
  tenantId: string;
  /** The tenant the token named when the switch started. */
  from: string | null;
  /** Where the user was when the switch started. */
  pathname: string;
}

/**
 * The one way to change tenant. Beyond the token exchange it does what the
 * exchange alone leaves broken: nothing for the old tenant stays in flight
 * while its grant is revoked, the URL follows the token when it names a
 * tenant, and the old tenant's data does not linger in the cache.
 */
export function useSwitchTenant() {
  const { user, switchTenant } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  const mutation = useMutation({
    mutationFn: ({ tenantId }: SwitchVariables) => switchTenant(tenantId),
    onMutate: async () => {
      // A request for the old tenant that 401s after its grant is revoked
      // would renew with a dead refresh token and sign the user out.
      await queryClient.cancelQueries();
    },
    onSuccess: async (_result, { tenantId, from, pathname }) => {
      const target = from
        ? replaceTenantInPath(pathname, from, tenantId)
        : pathname;
      if (target !== pathname) {
        void navigate(target, { replace: true });
      }

      // Reset rather than invalidate: an invalidated query keeps serving the
      // old tenant's data as stale while the new tenant's loads, which puts
      // one tenant's records on another tenant's screen for a moment.
      await queryClient.resetQueries({
        predicate: (query) => query.queryKey[0] !== authKeys.all[0],
      });
      await queryClient.invalidateQueries({ queryKey: authKeys.all });
    },
  });

  return {
    switchTo: (tenantId: string) => {
      mutation.mutate({
        tenantId,
        from: user?.tenantId ?? null,
        pathname: location.pathname,
      });
    },
    isSwitching: mutation.isPending,
    error: mutation.error,
  };
}
