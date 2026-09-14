import { Navigate } from 'react-router';

import { useAuth } from '@/lib/auth/context';

/**
 * The dashboard is the active tenant's overview. Every API call is scoped to
 * the token's tenant, so the address names it; this route only forwards
 * there. `replace` keeps Back from landing here and forwarding again.
 */
export function DashboardPage() {
  const { user } = useAuth();

  return (
    <Navigate
      to={user?.tenantId ? `/tenants/${user.tenantId}` : '/tenants'}
      replace
    />
  );
}
