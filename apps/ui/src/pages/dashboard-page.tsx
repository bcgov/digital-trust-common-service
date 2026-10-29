import { Navigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/common/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/common/card';
import { useActiveTenant } from '@/lib/tenant/active-tenant';

/**
 * The dashboard forwards to the current tenant overview when the token's
 * membership is still active, and provides a recovery screen otherwise.
 */
export function DashboardPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const { tenant, memberships, status, refetch } = useActiveTenant();
  const state = location.state as { tenantUserNotice?: unknown } | null;
  const notice =
    typeof state?.tenantUserNotice === 'string'
      ? state.tenantUserNotice
      : undefined;

  if (status === 'loading') {
    return <p role="status">{t('dashboard.loading')}</p>;
  }

  if (status === 'error') {
    return (
      <div role="alert" className="flex items-center gap-3">
        <p>{t('dashboard.loadFailed')}</p>
        <Button type="button" variant="outline" onClick={refetch}>
          {t('common.retry')}
        </Button>
        {notice && (
          <p
            role="status"
            aria-live="polite"
            className="text-sm text-green-700"
          >
            {notice}
          </p>
        )}
      </div>
    );
  }

  if (tenant) {
    return <Navigate to={`/tenants/${tenant.id}`} replace />;
  }

  const hasActiveMembership = memberships.some(
    (membership) => membership.status === 'active',
  );

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>
          {hasActiveMembership
            ? t('dashboard.chooseTitle')
            : t('dashboard.noMembershipTitle')}
        </CardTitle>
        <CardDescription>
          {hasActiveMembership
            ? t('dashboard.chooseBody')
            : t('dashboard.noMembershipBody')}
        </CardDescription>
        {notice && (
          <p
            role="status"
            aria-live="polite"
            className="text-sm text-green-700"
          >
            {notice}
          </p>
        )}
      </CardHeader>
    </Card>
  );
}
