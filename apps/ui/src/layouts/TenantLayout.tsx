import { NavLink, Outlet, useParams } from 'react-router';

import { TenantStatusBadge } from '@/components/tenant-status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/errors';
import { useTenant } from '@/lib/api/queries/tenants';
import { cn } from '@/lib/utils';

const TABS = [
  { to: '.', label: 'Overview', end: true },
  { to: 'users', label: 'Users' },
  { to: 'connections', label: 'Connections' },
  { to: 'credentials', label: 'Credentials' },
  { to: 'audit-logs', label: 'Audit logs' },
  { to: 'logs', label: 'Logs' },
  { to: 'settings', label: 'Settings' },
];

export function TenantLayout() {
  const { tenantId } = useParams();
  const { data: tenant, isLoading, error } = useTenant(tenantId);

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
      <div className="flex items-center gap-3">
        {isLoading ? (
          <Skeleton className="h-7 w-48" />
        ) : (
          <>
            <h1 className="text-xl font-semibold">
              {tenant?.name ?? 'Tenant'}
            </h1>
            {tenant?.status && <TenantStatusBadge status={tenant.status} />}
          </>
        )}
      </div>

      <nav aria-label="Tenant sections" className="flex gap-1 border-b">
        {TABS.map(({ to, label, end }) => (
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
            {label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}
