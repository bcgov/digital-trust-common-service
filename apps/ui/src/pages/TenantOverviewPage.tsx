import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/errors';
import type { Page } from '@/lib/api/pagination';
import { useConnections } from '@/lib/api/queries/connections';
import { useCredentialDefinitions } from '@/lib/api/queries/credential-definitions';
import { useTenant } from '@/lib/api/queries/tenants';
import { useAuth } from '@/lib/auth/context';
import { hasScope, USERS_MANAGE_SCOPE } from '@/lib/auth/scopes';

// Each action lands on the tenant section that owns it. An action the token
// cannot use is left out; the page behind it still handles a 403.
const QUICK_ACTIONS: { label: string; to: string; scope?: string }[] = [
  { label: 'Issue credential', to: 'credentials' },
  { label: 'Verify presentation', to: 'credentials' },
  { label: 'Manage users', to: 'users', scope: USERS_MANAGE_SCOPE },
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
  let value: ReactNode = '—';
  let hint: ReactNode = null;

  if (!query) {
    hint = <CardDescription>Coming soon.</CardDescription>;
  } else if (query.isLoading) {
    value = <Skeleton className="h-9 w-12" />;
  } else if (query.error instanceof ApiError && query.error.status === 403) {
    // A role without the read scope is the normal case, not a failure.
    hint = <CardDescription>Not available for your role.</CardDescription>;
  } else if (query.error) {
    hint = (
      <p role="alert" className="text-sm text-destructive">
        Failed to load
        {query.error instanceof ApiError ? `: ${query.error.message}` : '.'}
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
      <p role="alert" className="text-sm text-destructive">
        Failed to load tenant
        {error instanceof ApiError ? `: ${error.message}` : '.'}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Credential definitions" query={definitions} />
        <StatCard title="Active connections" query={connections} />
        <StatCard title="Recent operations" />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-medium">Quick actions</h2>
        <div className="flex flex-wrap gap-2">
          {quickActions.map(({ label, to }) => (
            <Button key={label} asChild variant="outline">
              <Link to={to}>{label}</Link>
            </Button>
          ))}
        </div>
      </section>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Slug</dt>
            <dd className="font-mono text-xs leading-5">
              {tenant?.slug ?? '—'}
            </dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd>{tenant?.status ?? '—'}</dd>
            <dt className="text-muted-foreground">Description</dt>
            <dd>{tenant?.description ?? '—'}</dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd>
              {tenant?.created_at
                ? new Date(tenant.created_at).toLocaleString()
                : '—'}
            </dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
