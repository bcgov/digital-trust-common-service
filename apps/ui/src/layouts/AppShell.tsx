import {
  Building2,
  ChevronsUpDown,
  LayoutDashboard,
  LogOut,
  Settings,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router';

import { BcGovHeader } from '@/components/bc-gov-header';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-svh flex-col">
      <BcGovHeader logoTo="/dashboard">
        {/* Tenant switcher placeholder — real switching arrives with #84 / AU-09. */}
        <Button
          variant="outline"
          size="sm"
          disabled
          title="Tenant switching arrives with the tenant dashboard (#84)"
        >
          <Building2 className="size-4" aria-hidden="true" />
          All tenants
          <ChevronsUpDown className="size-3.5 opacity-60" aria-hidden="true" />
        </Button>

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
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                // RequireAuth redirects to /login (replace) as soon as
                // logout clears the user — no manual navigation needed.
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
