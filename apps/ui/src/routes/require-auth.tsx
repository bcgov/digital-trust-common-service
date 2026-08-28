import { Navigate, Outlet, useLocation } from 'react-router';

import { FullPageStatus } from '@/components/full-page-status';
import { useAuth } from '@/lib/auth/context';

/** Layout route guarding everything behind it; preserves the intended URL. */
export function RequireAuth() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  // Restoring an OIDC session is async. Redirecting during that window would
  // throw an authenticated user out of a deep link — and, because the
  // redirect replaces history, silently drop where they were going.
  if (isLoading) {
    return <FullPageStatus message="Checking your session…" />;
  }

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  return <Outlet />;
}
