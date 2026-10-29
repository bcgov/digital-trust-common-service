import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useMatch,
  useParams,
} from 'react-router';

import { AccessDenied } from '@/components/common/access-denied';
import { TenantStatusBadge } from '@/components/tenant/tenant-status-badge';
import { Skeleton } from '@/components/common/skeleton';
import { ApiError } from '@/lib/api/errors';
import { useTenant } from '@/lib/api/queries/tenants';
import { useAuth } from '@/lib/auth/context';
import { hasScope, USERS_MANAGE_SCOPE } from '@/lib/auth/scopes';
import { replaceTenantInPath } from '@/lib/tenant/active-tenant';
import { cn } from '@/lib/utils';

// A tab whose section the token cannot use is left out; the page behind it
// still handles a 403 in case the token is stale.
const TABS: { to: string; label: ParseKeys; end?: boolean; scope?: string }[] =
  [
    { to: '.', label: 'tenantTabs.overview', end: true },
    { to: 'users', label: 'tenantTabs.users', scope: USERS_MANAGE_SCOPE },
    { to: 'connections', label: 'tenantTabs.connections' },
    { to: 'credentials', label: 'tenantTabs.credentials' },
    { to: 'audit-logs', label: 'tenantTabs.auditLogs' },
    { to: 'logs', label: 'tenantTabs.logs' },
    { to: 'settings', label: 'tenantTabs.settings' },
  ];

export function TenantLayout() {
  const { t } = useTranslation();
  const { tenantId } = useParams();
  const location = useLocation();
  const isUsersPage = useMatch('/tenants/:tenantId/users') !== null;
  const { user } = useAuth();
  const tabs = TABS.filter((tab) => !tab.scope || hasScope(user, tab.scope));

  // Every API call is scoped to the token's tenant, so a URL naming another
  // one can only 404. Land on the same section of the tenant the user is
  // actually in; the header switcher is the way to the other one.
  const redirectTo =
    tenantId && user?.tenantId && tenantId !== user.tenantId
      ? replaceTenantInPath(location.pathname, tenantId, user.tenantId)
      : null;
  const {
    data: tenant,
    isLoading,
    error,
  } = useTenant(redirectTo ? undefined : tenantId);

  if (redirectTo) {
    return <Navigate to={redirectTo} replace />;
  }

  if (error) {
    if (error instanceof ApiError && error.status === 403) {
      return (
        <AccessDenied
          title={t('tenant.title')}
          headingLevel={1}
          description={error.message}
        />
      );
    }

    return (
      <p role="alert" className="text-sm text-destructive">
        {error instanceof ApiError
          ? t('tenant.loadFailedWithReason', { reason: error.message })
          : t('tenant.loadFailed')}
      </p>
    );
  }

  return (
    <div className={cn('flex flex-col', !isUsersPage && 'gap-4')}>
      {!isUsersPage && (
        <>
          <div className="flex items-center gap-3">
            {isLoading ? (
              <Skeleton className="h-7 w-48" />
            ) : (
              <>
                <h1 className="text-xl font-semibold">
                  {tenant?.name ?? t('tenant.title')}
                </h1>
                {tenant?.status && <TenantStatusBadge status={tenant.status} />}
              </>
            )}
          </div>

          <nav
            aria-label={t('tenantTabs.label')}
            className="flex gap-1 border-b"
          >
            {tabs.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {t(label)}
              </NavLink>
            ))}
          </nav>
        </>
      )}

      <Outlet />
    </div>
  );
}
