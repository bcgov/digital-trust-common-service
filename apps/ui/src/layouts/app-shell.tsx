import {
  Building2,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Share2,
  UsersRound,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router';

import { BcGovHeader } from '@/components/common/bc-gov-header';
import { TenantSwitcher } from '@/components/tenant/tenant-switcher';
import { Avatar, AvatarFallback } from '@/components/common/avatar';
import { Badge } from '@/components/common/badge';
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
import { useAuth } from '@/lib/auth/context';
import { useActiveTenant } from '@/lib/tenant/active-tenant';
import {
  hasScope,
  TENANT_ADMIN_SCOPE,
  USERS_MANAGE_SCOPE,
} from '@/lib/auth/scopes';
import { cn } from '@/lib/utils';

const NAV_ITEMS: {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  scope?: string;
}[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  {
    to: '/connectors',
    label: 'Connectors',
    icon: Share2,
    scope: TENANT_ADMIN_SCOPE,
  },
  {
    to: '/api-clients',
    label: 'API integrations',
    icon: KeyRound,
    scope: 'clients:manage',
  },
];

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
  const { user, logout } = useAuth();
  const { tenant } = useActiveTenant();
  const navigationItems = NAV_ITEMS.filter(
    ({ scope }) => !scope || hasScope(user, scope),
  );
  const manageUsersPath =
    tenant?.id && hasScope(user, USERS_MANAGE_SCOPE)
      ? `/tenants/${tenant.id}/users`
      : null;

  return (
    <div className="flex min-h-svh flex-col">
      <BcGovHeader logoTo="/dashboard">
        <TenantSwitcher />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <Avatar className="size-7">
                <AvatarFallback>{initialsOf(user?.name)}</AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium">
                {user?.name ?? 'Account'}
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
                      {role}
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
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </BcGovHeader>

      <div className="flex flex-1">
        <aside className="w-60 shrink-0 border-r bg-sidebar text-sidebar-foreground">
          <div className="flex items-center gap-2 border-b px-3 py-3">
            <Building2 className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate text-sm font-semibold">
              {tenant?.name ?? 'Unknown tenant'}
            </span>
          </div>
          <nav aria-label="Primary" className="flex flex-col gap-1 p-2">
            {navigationItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-sidebar-foreground',
                  )
                }
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </NavLink>
            ))}
            {manageUsersPath && (
              <NavLink
                to={manageUsersPath}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-sidebar-foreground',
                  )
                }
              >
                <UsersRound className="size-4" aria-hidden="true" />
                Manage Users
              </NavLink>
            )}
          </nav>
        </aside>

        {/* tabIndex lets the skip link actually move keyboard focus here. */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex min-w-0 flex-1 flex-col p-6"
        >
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  );
}
