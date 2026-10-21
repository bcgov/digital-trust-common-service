import { Navigate, useLocation } from 'react-router';

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
  const location = useLocation();
  const { tenant, memberships, status, refetch } = useActiveTenant();
  const state = location.state as { tenantUserNotice?: unknown } | null;
  const notice =
    typeof state?.tenantUserNotice === 'string'
      ? state.tenantUserNotice
      : undefined;

  if (status === 'loading') {
    return <p role="status">Loading tenant memberships...</p>;
  }

  if (status === 'error') {
    return (
      <div role="alert" className="flex items-center gap-3">
        <p>Could not load your tenant memberships.</p>
        <Button type="button" variant="outline" onClick={refetch}>
          Retry
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
            ? 'Choose an active tenant'
            : 'No active tenant membership'}
        </CardTitle>
        <CardDescription>
          {hasActiveMembership
            ? 'Your current tenant is unavailable. Choose another active tenant from the tenant selector.'
            : 'You do not currently belong to an active tenant. Ask a tenant owner or administrator to invite you.'}
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
