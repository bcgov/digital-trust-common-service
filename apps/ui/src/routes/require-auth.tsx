import { Navigate, Outlet, useLocation } from 'react-router';

import { useAuth } from '@/lib/auth/context';

/** Layout route guarding everything behind it; preserves the intended URL. */
export function RequireAuth() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

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
