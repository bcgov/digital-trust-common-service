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
import { isPlatformAdmin } from '@/lib/auth/scopes';
import { replaceTenantInPath } from '@/lib/tenant/active-tenant';
import { cn } from '@/lib/utils';

export function TenantLayout() {
  const { t } = useTranslation();
  const { tenantId } = useParams();
  const location = useLocation();
  const isUsersPage = useMatch('/tenants/:tenantId/users') !== null;
  const { user } = useAuth();

  const viewingAnotherTenant = Boolean(
    tenantId && user?.tenantId && tenantId !== user.tenantId,
  );
  const redirectTo =
    viewingAnotherTenant && tenantId && user?.tenantId && !isPlatformAdmin(user)
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
      {viewingAnotherTenant && isPlatformAdmin(user) && (
        <InlineAlert
          variant="info"
          description={t('tenant.viewingAnother', {
            tenant: tenant?.name ?? tenantId,
          })}
        />
      )}
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

      <Outlet key={tenantId} />
    </div>
  );
}
