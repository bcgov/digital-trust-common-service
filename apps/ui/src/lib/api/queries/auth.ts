import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/lib/auth/context';

export const authKeys = {
  all: ['auth'] as const,
  tenants: ['auth', 'tenants'] as const,
};

/**
 * The caller's memberships, fetched through the auth seam rather than the
 * resource module so mock mode serves its fixture without a backend.
 *
 * The key carries no tenant id on purpose: the membership set belongs to the
 * person, and the API returns the same list from any of their tokens. A
 * switch invalidates it anyway, cheaply, in case a membership changed.
 */
export function useAuthTenants() {
  const { listAuthTenants } = useAuth();

  return useQuery({
    queryKey: authKeys.tenants,
    queryFn: () => listAuthTenants(),
    staleTime: 5 * 60_000,
  });
}
