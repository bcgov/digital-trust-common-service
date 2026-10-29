import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';

import { useAuth } from '@/lib/auth/context';
import { isPlatformAdmin } from '@/lib/auth/scopes';
import { useActiveTenant } from '@/lib/tenant/active-tenant';

/**
 * Where a sign-in with no destination lands. Platform admins and users with
 * more than one membership pick from the tenants list; everyone else goes
 * straight into their tenant through the dashboard, which also owns the
 * recovery screen for a failed membership load.
 */
export function LandingPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { memberships, status } = useActiveTenant();

  if (status === 'loading') {
    return <p role="status">{t('dashboard.loading')}</p>;
  }

  const picksTenant = isPlatformAdmin(user) || memberships.length > 1;
  return <Navigate to={picksTenant ? '/tenants' : '/dashboard'} replace />;
}
