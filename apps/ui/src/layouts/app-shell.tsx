import type { ParseKeys } from 'i18next';
import {
  Certificate,
  FileStack,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Share2,
  UsersRound,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useMatches } from 'react-router';

import { Avatar, AvatarFallback } from '@/components/common/avatar';
import { Badge } from '@/components/common/badge';
import { BcGovHeader } from '@/components/common/bc-gov-header';
import { Button } from '@/components/common/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import { Toaster } from '@/components/common/sonner';
import { BuildingIcon } from '@/components/common/icons';
import { TenantSwitcher } from '@/components/tenant/tenant-switcher';
import { useAuth } from '@/lib/auth/context';
import {
  hasScope,
  TENANT_ADMIN_SCOPE,
  USERS_MANAGE_SCOPE,
} from '@/lib/auth/scopes';
import { useActiveTenant } from '@/lib/tenant/active-tenant';
import { roleLabel } from '@/lib/tenant/roles';
import { cn } from '@/lib/utils';

const NAV_ITEMS: {
  to: string;
  label: ParseKeys;
  icon: typeof LayoutDashboard;
  scope?: string;
}[] = [
  { to: '/dashboard', label: 'nav.dashboard', icon: LayoutDashboard },
  {
    to: '/connectors',
    label: 'nav.connectors',
    icon: Share2,
    scope: TENANT_ADMIN_SCOPE,
  },
  {
    to: '/credential-definitions',
    label: 'credentialDefinitions.title',
    icon: Certificate,
    scope: TENANT_ADMIN_SCOPE,
  },
  {
    to: '/issuance-profiles',
    label: 'issuanceProfiles.title',
    icon: FileStack,
    scope: 'profiles:manage',
  },
  {
    to: '/api-clients',
    label: 'apiClients.title',
    icon: KeyRound,
    scope: 'clients:manage',
  },
];

/**
 * Route `handle` read by the shell. `centered` is the page frame from the
 * BCDS designs: no sidebar, a white surface, and content capped at 1280px
 * and centred with 80px gutters (1440px artboard).
 */
export interface AppShellHandle {
  layout?: 'sidebar' | 'centered';
}

function useShellLayout(): NonNullable<AppShellHandle['layout']> {
  const matches = useMatches();
  const handle = matches.at(-1)?.handle as AppShellHandle | undefined;
  return handle?.layout ?? 'sidebar';
}

function initialsOf(name: string | undefined): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function AppShell() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const { tenant } = useActiveTenant();
  const navigationItems = NAV_ITEMS.filter(
    ({ scope }) => !scope || hasScope(user, scope),
  );
  const layout = useShellLayout();
  const manageUsersPath =
    tenant?.id && hasScope(user, USERS_MANAGE_SCOPE)
      ? `/tenants/${tenant.id}/users`
      : null;

  return (
    <div className="flex h-svh flex-col">
      <BcGovHeader logoTo="/dashboard">
        <TenantSwitcher />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <Avatar className="size-7">
                <AvatarFallback>{initialsOf(user?.name)}</AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium">
                {user?.name ?? t('nav.account')}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-medium">{user?.name}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
              {user?.roles.length ? (
                <p className="mt-1 flex flex-wrap gap-1">
                  {user.roles.map((role) => (
                    <Badge key={role} variant="secondary">
                      {roleLabel(role)}
                    </Badge>
                  ))}
                </p>
              ) : null}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                // No manual navigation either way: mock logout clears the
                // user and RequireAuth redirects to /login, while OIDC
                // logout leaves the SPA entirely for the provider's
                // end-session endpoint and returns to /login from there.
                void logout();
              }}
            >
              <LogOut className="size-4" aria-hidden="true" />
              {t('nav.signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </BcGovHeader>

      <div className="flex flex-1 overflow-hidden">
        {layout === 'sidebar' && (
          <aside className="flex w-75 shrink-0 flex-col gap-(--layout-margin-small) overflow-y-auto border-r border-(--surface-color-border-default) bg-sidebar p-3 text-sidebar-foreground">
            <div className="flex items-center gap-3 rounded-(--layout-border-radius-large) border border-(--surface-color-border-default) p-3">
              <BuildingIcon className="size-6 shrink-0" />
              <span className="truncate text-body leading-5 font-bold text-black">
                {tenant?.name ?? t('nav.unknownTenant')}
              </span>
            </div>
            <nav
              aria-label={t('nav.primary')}
              className="flex flex-col gap-(--layout-margin-small)"
            >
              {navigationItems.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 rounded-(--layout-border-radius-large) px-3 py-(--layout-padding-small) text-small-body text-black transition-colors',
                      isActive ? 'bg-sidebar-accent' : 'hover:bg-muted',
                    )
                  }
                >
                  <Icon className="size-5" aria-hidden="true" />
                  {t(label)}
                </NavLink>
              ))}
              {manageUsersPath && (
                <NavLink
                  to={manageUsersPath}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 rounded-(--layout-border-radius-large) px-3 py-(--layout-padding-small) text-small-body text-black transition-colors',
                      isActive ? 'bg-sidebar-accent' : 'hover:bg-muted',
                    )
                  }
                >
                  <UsersRound className="size-5" aria-hidden="true" />
                  {t('nav.manageUsers')}
                </NavLink>
              )}
            </nav>
          </aside>
        )}

        {/* tabIndex lets the skip link actually move keyboard focus here. */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex min-w-0 flex-1 flex-col overflow-y-auto p-8"
        >
          <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col">
            <Outlet />
          </div>
        </main>
      </div>
      <Toaster />
    </div>
  );
}
