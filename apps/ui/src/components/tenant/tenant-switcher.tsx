import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { TenantStatusBadge } from './tenant-status-badge';
import { Badge } from '@/components/common/badge';
import { Button } from '@/components/common/button';
import { BuildingIcon } from '@/components/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import { Skeleton } from '@/components/common/skeleton';
import { ApiError } from '@/lib/api/errors';
import type { AuthTenant } from '@/lib/api/resources/auth';
import { useAuth } from '@/lib/auth/context';
import i18n from '@/lib/i18n';
import { useActiveTenant, useSwitchTenant } from '@/lib/tenant/active-tenant';
import { roleLabel } from '@/lib/tenant/roles';

function switchErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'TENANT_NOT_ACTIVE':
        return i18n.t('switcher.errorNotActive');
      case 'TENANT_ACCESS_DENIED':
        return i18n.t('switcher.errorNotMember');
      default:
        return i18n.t('switcher.errorWithReason', { reason: error.message });
    }
  }
  return i18n.t('switcher.errorGeneric');
}

/** Name, role and (when it matters) status of the active tenant. */
function ActiveTenantLabel({ tenant }: { tenant: AuthTenant | null }) {
  const { t } = useTranslation();
  return (
    <>
      <span className="truncate">{tenant?.name ?? t('nav.unknownTenant')}</span>
      {tenant ? (
        <Badge variant="secondary">{roleLabel(tenant.role)}</Badge>
      ) : null}
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
  const { t } = useTranslation();
  const { user } = useAuth();
  const { tenant, memberships, status, refetch } = useActiveTenant();
  const { switchTo, isSwitching, error } = useSwitchTenant();

  if (status === 'loading') {
    return (
      <div role="status" className="flex items-center">
        <Skeleton className="h-8 w-40" />
        <span className="sr-only">{t('switcher.loading')}</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 text-sm text-destructive"
      >
        {t('switcher.loadFailed')}
        <Button variant="outline" size="sm" onClick={refetch}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  // The dropdown only exists when there is somewhere else to go. That is
  // not the same as "more than one membership": a token bound to a tenant
  // the list no longer carries still needs the way to the one it does.
  const canSwitch = memberships.some(
    (membership) => membership.id !== user?.tenantId,
  );

  if (!canSwitch) {
    return (
      <div className="flex items-center gap-2 text-sm font-medium">
        <BuildingIcon className="size-4" />
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
            title={t('switcher.title')}
          >
            {isSwitching ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <BuildingIcon className="size-4" />
            )}
            <ActiveTenantLabel tenant={tenant} />
            <ChevronsUpDown
              className="size-3.5 opacity-60"
              aria-hidden="true"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>{t('switcher.title')}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {memberships.map((membership) => {
            const isCurrent = membership.id === user?.tenantId;
            return (
              <DropdownMenuItem
                key={membership.id}
                disabled={isSwitching || membership.status !== 'active'}
                onSelect={() => {
                  if (!isCurrent) {
                    void switchTo(membership.id).catch(() => undefined);
                  }
                }}
              >
                <span className="flex-1 truncate">{membership.name}</span>
                <span className="text-xs text-muted-foreground">
                  {roleLabel(membership.role)}
                </span>
                {membership.status !== 'active' ? (
                  <span className="text-xs text-muted-foreground">
                    {t(`tenants.status.${membership.status}`)}
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
