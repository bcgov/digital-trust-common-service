import { InlineAlert } from '@bcgov/design-system-react-components';
import { useTranslation } from 'react-i18next';
import {
  Navigate,
  Outlet,
  useLocation,
  useMatch,
  useParams,
} from 'react-router';

import { AccessDenied } from '@/components/common/access-denied';
import { TenantStatusTag } from '@/components/tenant/tenant-status-badge';
import { Skeleton } from '@/components/common/skeleton';
import { ApiError } from '@/lib/api/errors';
import { useTenant } from '@/lib/api/queries/tenants';
import { useAuth } from '@/lib/auth/context';
import { replaceTenantInPath } from '@/lib/tenant/active-tenant';
import { cn } from '@/lib/utils';

export function TenantLayout() {
  const { t } = useTranslation();
  const { tenantId } = useParams();
  const location = useLocation();
  const isUsersPage = useMatch('/tenants/:tenantId/users') !== null;
  const { user } = useAuth();

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
      <InlineAlert
        variant="danger"
        role="alert"
        description={
          error instanceof ApiError
            ? t('tenant.loadFailedWithReason', { reason: error.message })
            : t('tenant.loadFailed')
        }
      />
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col',
        !isUsersPage && 'gap-(--layout-margin-large)',
      )}
    >
      {!isUsersPage && (
        <>
          <div className="flex items-center gap-(--layout-margin-medium)">
            {isLoading ? (
              <Skeleton className="h-12 w-64" />
            ) : (
              <>
                <h1 className="text-h1 font-bold text-black">
                  {tenant?.name ?? t('tenant.title')}
                </h1>
                {tenant?.status && <TenantStatusTag status={tenant.status} />}
              </>
            )}
          </div>
        </>
      )}

      <Outlet />
    </div>
  );
}
