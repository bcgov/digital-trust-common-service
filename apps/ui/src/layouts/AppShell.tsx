import { useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Check,
  ChevronsUpDown,
  LayoutDashboard,
  LogOut,
  Settings,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router';

import { BcGovHeader } from '@/components/bc-gov-header';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
import { ApiError } from '@/lib/api/errors';
import type { AuthTenant } from '@/lib/api/resources/auth';
import { useAuth } from '@/lib/auth/context';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/tenants', label: 'Tenants', icon: Building2 },
  { to: '/settings', label: 'Settings', icon: Settings },
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
  const { user, logout, listAuthTenants, switchTenant } = useAuth();
  const queryClient = useQueryClient();
  const [tenants, setTenants] = useState<AuthTenant[]>([]);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  useEffect(() => {
    void listAuthTenants()
      .then(setTenants)
      .catch(() => setTenants([]));
  }, [listAuthTenants, user?.tenantId]);

  const current = tenants.find((tenant) => tenant.id === user?.tenantId);
  const canSwitch = tenants.length > 1;

  const onSelectTenant = async (tenantId: string) => {
    if (!canSwitch || tenantId === user?.tenantId || switching) return;
    setSwitching(true);
    setSwitchError(null);
    try {
      await switchTenant(tenantId);
      await queryClient.invalidateQueries();
    } catch (cause) {
      setSwitchError(
        cause instanceof ApiError
          ? `Couldn't switch tenant: ${cause.message}`
          : "Couldn't switch tenant. Please try again.",
      );
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="flex min-h-svh flex-col">
      <BcGovHeader logoTo="/dashboard">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={!canSwitch || switching}
              title={
                canSwitch
                  ? 'Switch tenant'
                  : 'Tenant switching requires membership in more than one tenant'
              }
            >
              <Building2 className="size-4" aria-hidden="true" />
              {current?.name ?? 'All tenants'}
              <ChevronsUpDown
                className="size-3.5 opacity-60"
                aria-hidden="true"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>Tenants</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {tenants.map((tenant) => (
              <DropdownMenuItem
                key={tenant.id}
                disabled={switching || tenant.status !== 'active'}
                onSelect={() => {
                  void onSelectTenant(tenant.id);
                }}
              >
                <span className="flex-1 truncate">{tenant.name}</span>
                {tenant.status !== 'active' ? (
                  <span className="text-xs text-muted-foreground">
                    {tenant.status}
                  </span>
                ) : tenant.id === user?.tenantId ? (
                  <Check className="size-4" aria-hidden="true" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {switchError ? (
          <p role="alert" className="text-sm text-destructive">
            {switchError}
          </p>
        ) : null}

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
          <nav aria-label="Primary" className="flex flex-col gap-1 p-2">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
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
          </nav>
        </aside>

        {/* tabIndex lets the skip link actually move keyboard focus here. */}
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
