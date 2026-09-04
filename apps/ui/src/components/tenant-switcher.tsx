import { Building2, Check, ChevronsUpDown, Loader2 } from 'lucide-react';

import { TenantStatusBadge } from '@/components/tenant-status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/errors';
import type { AuthTenant } from '@/lib/api/resources/auth';
import { useAuth } from '@/lib/auth/context';
import { useActiveTenant, useSwitchTenant } from '@/lib/tenant/active-tenant';

function switchErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'TENANT_NOT_ACTIVE':
        return "Couldn't switch tenant: it isn't active.";
      case 'TENANT_ACCESS_DENIED':
        return "Couldn't switch tenant: you're not a member.";
      default:
        return `Couldn't switch tenant: ${error.message}`;
    }
  }
  return "Couldn't switch tenant. Please try again.";
}

/** Name, role and (when it matters) status of the active tenant. */
function ActiveTenantLabel({ tenant }: { tenant: AuthTenant | null }) {
  return (
    <>
      <span className="truncate">{tenant?.name ?? 'Unknown tenant'}</span>
      {tenant ? <Badge variant="secondary">{tenant.role}</Badge> : null}
      {tenant && tenant.status !== 'active' ? (
        <TenantStatusBadge status={tenant.status} />
      ) : null}
    </>
  );
}

/**
 * The active tenant, always visible in the header, and the way to change it
 * for users who belong to more than one. The dropdown only exists when there
 * is somewhere to switch to.
 */
export function TenantSwitcher() {
  const { user } = useAuth();
  const { tenant, memberships, status, refetch } = useActiveTenant();
  const { switchTo, isSwitching, error } = useSwitchTenant();

  if (status === 'loading') {
    return (
      <div role="status" className="flex items-center">
        <Skeleton className="h-8 w-40" />
        <span className="sr-only">Loading tenants…</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 text-sm text-destructive"
      >
        Couldn't load your tenants.
        <Button variant="outline" size="sm" onClick={refetch}>
          Retry
        </Button>
      </div>
    );
  }

  if (memberships.length <= 1) {
    return (
      <div className="flex items-center gap-2 text-sm font-medium">
        <Building2 className="size-4" aria-hidden="true" />
        <ActiveTenantLabel tenant={tenant} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={isSwitching}
            title="Switch tenant"
          >
            {isSwitching ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Building2 className="size-4" aria-hidden="true" />
            )}
            <ActiveTenantLabel tenant={tenant} />
            <ChevronsUpDown
              className="size-3.5 opacity-60"
              aria-hidden="true"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Switch tenant</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {memberships.map((membership) => {
            const isCurrent = membership.id === user?.tenantId;
            return (
              <DropdownMenuItem
                key={membership.id}
                disabled={isSwitching || membership.status !== 'active'}
                onSelect={() => {
                  if (!isCurrent) switchTo(membership.id);
                }}
              >
                <span className="flex-1 truncate">{membership.name}</span>
                <span className="text-xs text-muted-foreground">
                  {membership.role}
                </span>
                {membership.status !== 'active' ? (
                  <span className="text-xs text-muted-foreground">
                    {membership.status}
                  </span>
                ) : isCurrent ? (
                  <Check className="size-4" aria-hidden="true" />
                ) : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {switchErrorMessage(error)}
        </p>
      ) : null}
    </div>
  );
}
