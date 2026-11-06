import {
  Button,
  Callout,
  InlineAlert,
} from '@bcgov/design-system-react-components';
import { Navigate } from 'react-router';
import { useTranslation } from 'react-i18next';

import { useActiveTenant } from '@/lib/tenant/active-tenant';

/**
 * The dashboard forwards to the current tenant overview when the token's
 * membership is still active, and provides a recovery screen otherwise.
 */
export function DashboardPage() {
  const { t } = useTranslation();
  const { tenant, memberships, status, refetch } = useActiveTenant();

  if (status === 'loading') {
    return <p role="status">{t('dashboard.loading')}</p>;
  }

  if (status === 'error') {
    return (
      <InlineAlert
        variant="danger"
        role="alert"
        description={t('dashboard.loadFailed')}
        buttons={
          <Button variant="secondary" size="small" onPress={refetch}>
            {t('common.retry')}
          </Button>
        }
      />
    );
  }

  if (tenant) {
    return <Navigate to={`/tenants/${tenant.id}`} replace />;
  }

  const hasActiveMembership = memberships.some(
    (membership) => membership.status === 'active',
  );

  return (
    <div className="max-w-lg">
      <Callout
        title={
          hasActiveMembership
            ? t('dashboard.chooseTitle')
            : t('dashboard.noMembershipTitle')
        }
        description={
          hasActiveMembership
            ? t('dashboard.chooseBody')
            : t('dashboard.noMembershipBody')
        }
      />
    </div>
  );
}
