import type { ParseKeys } from 'i18next';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams } from 'react-router';

import { Button } from '@/components/common/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/common/card';
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
    hint = <CardDescription>{t('overview.comingSoon')}</CardDescription>;
  } else if (query.isLoading) {
    value = <Skeleton className="h-9 w-12" />;
  } else if (query.error instanceof ApiError && query.error.status === 403) {
    // A role without the read scope is the normal case, not a failure.
    hint = <CardDescription>{t('overview.notForRole')}</CardDescription>;
  } else if (query.error) {
    hint = (
      <p role="alert" className="text-sm text-destructive">
        {query.error instanceof ApiError
          ? t('overview.loadFailedWithReason', { reason: query.error.message })
          : t('overview.loadFailed')}
      </p>
    );
  } else if (query.data) {
    // No endpoint reports a total, so a full page is a lower bound.
    const { data, pagination } = query.data;
    value = `${data.length}${pagination.has_more ? '+' : ''}`;
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
        {hint}
      </CardHeader>
    </Card>
  );
}

export function TenantOverviewPage() {
  const { t, i18n } = useTranslation();
  const { tenantId } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const state = location.state as { tenantUserNotice?: unknown } | null;
  const notice =
    typeof state?.tenantUserNotice === 'string'
      ? state.tenantUserNotice
      : undefined;
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
      <p role="alert" className="text-sm text-destructive">
        {error instanceof ApiError
          ? t('tenant.loadFailedWithReason', { reason: error.message })
          : t('tenant.loadFailed')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <p role="status" aria-live="polite" className="text-sm text-green-700">
          {notice}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title={t('overview.definitions')} query={definitions} />
        <StatCard title={t('overview.activeConnections')} query={connections} />
        <StatCard title={t('overview.recentOperations')} />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-medium">{t('overview.quickActions')}</h2>
        <div className="flex flex-wrap gap-2">
          {quickActions.map(({ label, to }) => (
            <Button key={label} asChild variant="outline">
              <Link to={to}>{t(label)}</Link>
            </Button>
          ))}
        </div>
      </section>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>{t('overview.details')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">
              {t('tenants.fields.slug')}
            </dt>
            <dd className="font-mono text-xs leading-5">
              {tenant?.slug ?? '—'}
            </dd>
            <dt className="text-muted-foreground">{t('common.status')}</dt>
            <dd>
              {tenant?.status ? t(`tenants.status.${tenant.status}`) : '—'}
            </dd>
            <dt className="text-muted-foreground">
              {t('tenants.fields.description')}
            </dt>
            <dd>{tenant?.description ?? '—'}</dd>
            <dt className="text-muted-foreground">{t('common.created')}</dt>
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
        </CardContent>
      </Card>
    </div>
  );
}
