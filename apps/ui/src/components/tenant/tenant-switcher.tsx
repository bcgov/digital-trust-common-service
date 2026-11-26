import {
  Button,
  Menu,
  MenuItem,
  MenuSection,
  MenuSectionHeader,
  MenuTrigger,
  SvgChevronDownIcon,
} from '@bcgov/design-system-react-components';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { TenantStatusBadge } from './tenant-status-badge';
import { Button as ActionButton } from '@/components/common/button';
import { BuildingIcon } from '@/components/common/icons';
import { Skeleton } from '@/components/common/skeleton';
import type { AuthTenant } from '@/lib/api/resources/auth';
import { useAuth } from '@/lib/auth/context';
import { useActiveTenant, useSwitchTenant } from '@/lib/tenant/active-tenant';
import { roleLabel } from '@/lib/tenant/roles';
import { switchErrorMessage } from '@/lib/tenant/switch-error';
import { cn } from '@/lib/utils';

const CARD_CLASSES =
  'flex w-full items-center gap-2 rounded-(--layout-border-radius-large) border border-(--surface-color-border-default) px-3 py-4 text-left';

/** Name, role and (when it matters) status of the active tenant. */
function ActiveTenantLabel({ tenant }: { tenant: AuthTenant | null }) {
  const { t } = useTranslation();
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-body leading-5 font-bold text-black">
        {tenant?.name ?? t('nav.unknownTenant')}
      </span>
      {tenant ? (
        <span className="flex items-center gap-2 text-label text-(--typography-color-secondary)">
          {roleLabel(tenant.role)}
          {tenant.status !== 'active' ? (
            <TenantStatusBadge status={tenant.status} />
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The active tenant at the top of the sidebar, with the user's role in it,
 * and the way to change it for users who belong to more than one. The menu
 * only exists when there is somewhere to switch to.
 */
export function TenantSwitcher() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { tenant, memberships, status, refetch } = useActiveTenant();
  const { switchTo, isSwitching, error } = useSwitchTenant();

  if (status === 'loading') {
    return (
      <div role="status" className="flex items-center">
        <Skeleton className="h-18 w-full" />
        <span className="sr-only">{t('switcher.loading')}</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-2 text-sm text-destructive"
      >
        {t('switcher.loadFailed')}
        <ActionButton variant="outline" size="sm" onClick={refetch}>
          {t('common.retry')}
        </ActionButton>
      </div>
    );
  }

  // The menu only exists when there is somewhere else to go. That is not
  // the same as "more than one membership": a token bound to a tenant the
  // list no longer carries still needs the way to the one it does.
  const canSwitch = memberships.some(
    (membership) => membership.id !== user?.tenantId,
  );

  if (!canSwitch) {
    return (
      <div className={CARD_CLASSES}>
        <BuildingIcon className="size-6 shrink-0" />
        <ActiveTenantLabel tenant={tenant} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <MenuTrigger>
        {/* className replaces the BCDS button styling; the Figma trigger
            is a card, but it must still be the BCDS (bundled react-aria)
            Button for MenuTrigger to wire it up. */}
        <Button
          isDisabled={isSwitching}
          className={cn(
            CARD_CLASSES,
            'cursor-pointer bg-transparent transition-colors outline-none',
            'data-hovered:bg-(--surface-color-secondary-hover)',
            'data-pressed:bg-(--surface-color-secondary-pressed) aria-expanded:bg-(--surface-color-secondary-pressed)',
            'data-focus-visible:outline-2 data-focus-visible:outline-offset-1 data-focus-visible:outline-(--surface-color-border-active)',
            'data-disabled:cursor-wait',
          )}
        >
          {isSwitching ? (
            <Loader2
              className="size-6 shrink-0 animate-spin"
              aria-hidden="true"
            />
          ) : (
            <BuildingIcon className="size-6 shrink-0" />
          )}
          <ActiveTenantLabel tenant={tenant} />
          <SvgChevronDownIcon />
        </Button>
        <Menu
          placement="bottom start"
          className="bcds-react-aria-Menu medium tenant-switcher-menu"
          selectionMode="single"
          selectedKeys={user?.tenantId ? [user.tenantId] : []}
          onAction={(key) => {
            if (key !== user?.tenantId) {
              void switchTo(String(key)).catch(() => undefined);
            }
          }}
        >
          <MenuSection>
            <MenuSectionHeader>{t('switcher.menuHeading')}</MenuSectionHeader>
            {memberships.map((membership) => (
              <MenuItem
                key={membership.id}
                id={membership.id}
                label={membership.name}
                description={
                  membership.status === 'active'
                    ? roleLabel(membership.role)
                    : t(`tenants.status.${membership.status}`)
                }
                isDisabled={isSwitching || membership.status !== 'active'}
              />
            ))}
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
