import { InlineAlert } from '@bcgov/design-system-react-components';
import type { ParseKeys } from 'i18next';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import { Skeleton } from '@/components/common/skeleton';
import { ApiError } from '@/lib/api/errors';
import type { Page } from '@/lib/api/pagination';
import { useConnections } from '@/lib/api/queries/connections';
import { useCredentialDefinitions } from '@/lib/api/queries/credential-definitions';
import { useTenant } from '@/lib/api/queries/tenants';
import { useAuth } from '@/lib/auth/context';
import { hasScope, USERS_MANAGE_SCOPE } from '@/lib/auth/scopes';

// Each action lands on the tenant section that owns it. An action the token
// cannot use is left out; the page behind it still handles a 403.
const QUICK_ACTIONS: { label: ParseKeys; to: string; scope?: string }[] = [
  { label: 'overview.issueCredential', to: 'credentials' },
  { label: 'overview.verifyPresentation', to: 'credentials' },
  { label: 'overview.manageUsers', to: 'users', scope: USERS_MANAGE_SCOPE },
];

interface StatCardProps {
  title: string;
  /** Omitted while the API has no endpoint for this figure. */
  query?: {
    data?: Page<unknown>;
    isLoading: boolean;
    error: Error | null;
  };
}

function StatCard({ title, query }: StatCardProps) {
  const { t } = useTranslation();
  let value: ReactNode = '—';
  let hint: ReactNode = null;

  if (!query) {
    hint = (
      <p className="text-sm text-(--typography-color-secondary)">
        {t('overview.comingSoon')}
      </p>
    );
  } else if (query.isLoading) {
    value = <Skeleton className="h-9 w-12" />;
  } else if (query.error instanceof ApiError && query.error.status === 403) {
    // A role without the read scope is the normal case, not a failure.
    hint = (
      <p className="text-sm text-(--typography-color-secondary)">
        {t('overview.notForRole')}
      </p>
    );
  } else if (query.error) {
    hint = (
      <InlineAlert
        variant="danger"
        role="alert"
        description={
          query.error instanceof ApiError
            ? t('overview.loadFailedWithReason', {
                reason: query.error.message,
              })
            : t('overview.loadFailed')
        }
      />
    );
  } else if (query.data) {
    // No endpoint reports a total, so a full page is a lower bound.
    const { data, pagination } = query.data;
    value = `${data.length}${pagination.has_more ? '+' : ''}`;
  }

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-(--surface-color-border-default) bg-(--surface-color-background-white) p-4">
      <p className="text-sm text-(--typography-color-secondary)">{title}</p>
      <div className="text-3xl font-medium tabular-nums">{value}</div>
      {hint}
    </div>
  );
}

export function TenantOverviewPage() {
  const { t, i18n } = useTranslation();
  const { tenantId } = useParams();
  const { user } = useAuth();
  const { data: tenant, isLoading, error } = useTenant(tenantId);
  const definitions = useCredentialDefinitions(tenantId);
  const connections = useConnections(tenantId, { state: 'active', limit: 100 });

  const quickActions = QUICK_ACTIONS.filter(
    (action) => !action.scope || hasScope(user, action.scope),
  );

  if (isLoading) {
    return <Skeleton className="h-40 w-full max-w-lg" />;
  }

  if (error) {
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
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title={t('overview.definitions')} query={definitions} />
        <StatCard title={t('overview.activeConnections')} query={connections} />
        <StatCard title={t('overview.recentOperations')} />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-medium">{t('overview.quickActions')}</h2>
        <div className="flex flex-wrap gap-2">
          {quickActions.map(({ label, to }) => (
            <Link
              key={label}
              to={to}
              className="bcds-react-aria-Button medium secondary"
            >
              {t(label)}
            </Link>
          ))}
        </div>
      </section>

      <section className="flex max-w-lg flex-col gap-4 rounded-xl border border-(--surface-color-border-default) bg-(--surface-color-background-white) p-4">
        <h2 className="text-base font-medium">{t('overview.details')}</h2>
        <div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-(--typography-color-secondary)">
              {t('tenants.fields.slug')}
            </dt>
            <dd className="font-mono text-xs leading-5">
              {tenant?.slug ?? '—'}
            </dd>
            <dt className="text-(--typography-color-secondary)">
              {t('common.status')}
            </dt>
            <dd>
              {tenant?.status ? t(`tenants.status.${tenant.status}`) : '—'}
            </dd>
            <dt className="text-(--typography-color-secondary)">
              {t('tenants.fields.description')}
            </dt>
            <dd>{tenant?.description ?? '—'}</dd>
            <dt className="text-(--typography-color-secondary)">
              {t('common.created')}
            </dt>
            <dd>
              {tenant?.created_at
                ? new Intl.DateTimeFormat(i18n.language, {
                    year: 'numeric',
                    month: 'numeric',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: 'numeric',
                    second: 'numeric',
                  }).format(new Date(tenant.created_at))
                : '—'}
            </dd>
          </dl>
        </div>
      </section>
    </div>
  );
}
