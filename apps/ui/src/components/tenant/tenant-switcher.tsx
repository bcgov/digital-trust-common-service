import {
  Button,
  Menu,
  MenuItem,
  MenuSection,
  MenuSectionHeader,
  MenuTrigger,
} from '@bcgov/design-system-react-components';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMatch, useNavigate } from 'react-router';

import { TenantStatusBadge } from './tenant-status-badge';
import { Button as RetryButton } from '@/components/common/button';
import { BuildingIcon } from '@/components/common/icons';
import { Skeleton } from '@/components/common/skeleton';
import { useSwitcherTenants } from '@/lib/api/queries/tenants';
import type { TenantStatus } from '@/lib/api/resources/tenants';
import { useAuth } from '@/lib/auth/context';
import { isPlatformAdmin } from '@/lib/auth/scopes';
import {
  replaceTenantInPath,
  useActiveTenant,
  useSwitchTenant,
} from '@/lib/tenant/active-tenant';
import { roleLabel } from '@/lib/tenant/roles';
import { switchErrorMessage } from '@/lib/tenant/switch-error';

/** Name, role and (when it matters) status of the active tenant. */
function ActiveTenantLabel({
  tenant,
  role,
}: {
  tenant: { name: string; status?: TenantStatus } | null;
  role: string | undefined;
}) {
  const { t } = useTranslation();
  return (
    <span className="flex min-w-0 flex-1 flex-col items-start text-left">
      <span className="w-full truncate text-h5 font-bold text-(--typography-color-primary)">
        {tenant?.name ?? t('nav.unknownTenant')}
      </span>
      {tenant && (
        <span className="text-small-body text-(--typography-color-secondary)">
          {role}
        </span>
      )}
      {tenant?.status && tenant.status !== 'active' ? (
        <TenantStatusBadge status={tenant.status} />
      ) : null}
    </span>
  );
}

const cardClassName =
  'flex min-h-20 w-full min-w-0 items-center gap-3 rounded-(--layout-border-radius-large) border border-(--surface-color-border-default) bg-(--surface-color-background-white) p-4';

/**
 * Members switch their signed-in tenant; platform admins view tenants without
 * changing their token.
 */
export function TenantSwitcher() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const platformAdmin = isPlatformAdmin(user);
  const { tenant, memberships, status, refetch } = useActiveTenant();
  const allTenants = useSwitcherTenants(platformAdmin);
  const { switchTo, isSwitching, error } = useSwitchTenant();
  const tenantRoute = useMatch('/tenants/:tenantId/*');
  const navigate = useNavigate();

  if (status === 'loading' || (platformAdmin && allTenants.isLoading)) {
    return (
      <div role="status" className="flex items-center">
        <Skeleton className="h-8 w-40" />
        <span className="sr-only">{t('switcher.loading')}</span>
      </div>
    );
  }

  if (status === 'error' || (platformAdmin && allTenants.isError)) {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 text-sm text-destructive"
      >
        {t('switcher.loadFailed')}
        <RetryButton
          variant="outline"
          size="sm"
          onClick={() => {
            if (status === 'error') refetch();
            if (platformAdmin && allTenants.isError) void allTenants.refetch();
          }}
        >
          {t('common.retry')}
        </RetryButton>
      </div>
    );
  }

  // The dropdown only exists when there is somewhere else to go. That is
  // not the same as "more than one membership": a token bound to a tenant
  // the list no longer carries still needs the way to the one it does.
  const entries = platformAdmin ? (allTenants.data ?? []) : memberships;
  const viewedTenantId = tenantRoute?.params.tenantId ?? user?.tenantId;
  const viewedTenant = platformAdmin
    ? (entries.find((entry) => entry.id === viewedTenantId) ?? null)
    : tenant;
  const viewedRole = platformAdmin
    ? t('switcher.platformAdmin')
    : roleLabel(tenant?.role);
  const canSwitch = entries.some((entry) => entry.id !== viewedTenantId);

  if (!canSwitch) {
    return (
      <div className={cardClassName}>
        <BuildingIcon className="size-6 shrink-0" />
        <ActiveTenantLabel tenant={viewedTenant} role={viewedRole} />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <MenuTrigger>
        <Button
          className={`${cardClassName} cursor-pointer hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50`}
          isDisabled={isSwitching}
        >
          {isSwitching ? (
            <Loader2
              className="size-6 shrink-0 animate-spin"
              aria-hidden="true"
            />
          ) : (
            <BuildingIcon className="size-6 shrink-0" />
          )}
          <ActiveTenantLabel tenant={viewedTenant} role={viewedRole} />
          <ChevronDown className="size-5 shrink-0" aria-hidden="true" />
          <span className="sr-only">{t('switcher.title')}</span>
        </Button>
        <Menu
          aria-label={t('switcher.title')}
          placement="bottom start"
          className="bcds-react-aria-Menu medium max-h-[60vh] w-87.5 max-w-[calc(100vw-2rem)] overflow-y-auto"
          onAction={(key) => {
            if (platformAdmin) {
              const selected = entries.find((entry) => entry.id === key);
              if (!selected) return;
              const target = tenantRoute?.params.tenantId
                ? replaceTenantInPath(
                    tenantRoute.pathname,
                    tenantRoute.params.tenantId,
                    selected.id,
                  )
                : `/tenants/${selected.id}`;
              void navigate(target);
              return;
            }
            const membership = memberships.find((item) => item.id === key);
            if (membership && membership.id !== user?.tenantId) {
              void switchTo(membership.id).catch(() => undefined);
            } else if (membership && tenantRoute?.params.tenantId) {
              void navigate(
                replaceTenantInPath(
                  tenantRoute.pathname,
                  tenantRoute.params.tenantId,
                  membership.id,
                ),
                { replace: true },
              );
            }
          }}
        >
          <MenuSection>
            <MenuSectionHeader>
              <span className="text-body font-normal">
                {t('switcher.menuHeading')}
              </span>
            </MenuSectionHeader>
            {entries.map((entry) => {
              const membership = memberships.find(
                (item) => item.id === entry.id,
              );
              const isCurrent = entry.id === viewedTenantId;
              const isDisabled =
                isSwitching || (!platformAdmin && entry.status !== 'active');
              const inactiveStatus =
                entry.status && entry.status !== 'active'
                  ? t(`tenants.status.${entry.status}`)
                  : null;
              return (
                <MenuItem
                  key={entry.id}
                  id={entry.id}
                  textValue={entry.name}
                  isDisabled={isDisabled}
                >
                  <span className="flex min-w-0 flex-1 flex-col items-start text-left">
                    <span
                      className={`w-full truncate text-h5 font-bold ${isDisabled ? '' : 'text-(--typography-color-primary)'} ${inactiveStatus ? 'opacity-70' : ''}`}
                    >
                      {entry.name}
                    </span>
                    {(platformAdmin || !inactiveStatus) && (
                      <span className="text-body">
                        {platformAdmin
                          ? t('switcher.platformAdmin')
                          : membership && roleLabel(membership.role)}
                      </span>
                    )}
                    {inactiveStatus && (
                      <span className="text-small-body opacity-70">
                        {inactiveStatus}
                      </span>
                    )}
                  </span>
                  {isCurrent && (
                    <span className="shrink-0 self-center">
                      <Check className="size-5" aria-hidden="true" />
                    </span>
                  )}
                </MenuItem>
              );
            })}
          </MenuSection>
        </Menu>
      </MenuTrigger>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {switchErrorMessage(error)}
        </p>
      ) : null}
    </div>
  );
}
