import { useParams } from 'react-router';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/errors';
import { useTenant } from '@/lib/api/queries/tenants';

export function TenantOverviewPage() {
  const { tenantId } = useParams();
  const { data: tenant, isLoading, error } = useTenant(tenantId);

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
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Details</CardTitle>
        <CardDescription>
          Overview cards (definitions, connections, operations) arrive with #84.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Slug</dt>
          <dd className="font-mono text-xs leading-5">{tenant?.slug ?? '—'}</dd>
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
  );
}
